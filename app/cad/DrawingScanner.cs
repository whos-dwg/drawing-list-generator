using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Autodesk.AutoCAD.Runtime;

namespace DrawingList.CadPlugin
{
    public sealed class DrawingScanner
    {
        [CommandMethod("DLSCANFILE", CommandFlags.Session)]
        public void ScanFile()
        {
            var input = Environment.GetEnvironmentVariable("DRAWING_LIST_DWG");
            var output = Environment.GetEnvironmentVariable("DRAWING_LIST_OUTPUT");
            if (String.IsNullOrWhiteSpace(input))
            {
                WriteError(output, "", "DWG_INPUT_MISSING", "DRAWING_LIST_DWG was not supplied.");
                return;
            }
            if (String.IsNullOrWhiteSpace(output)) output = Path.ChangeExtension(input, ".drawing-list.json");

            Database previous = null;
            try
            {
                using (var db = new Database(false, true))
                {
                    db.ReadDwgFile(input, FileShare.ReadWrite, false, null);
                    db.CloseInput(true);
                    previous = HostApplicationServices.WorkingDatabase;
                    HostApplicationServices.WorkingDatabase = db;
                    var json = ScanDatabase(db, Path.GetFileName(input), ReadTargetNames(), ReadNumberTag());
                    File.WriteAllText(output, json, new UTF8Encoding(false));
                    HostApplicationServices.WorkingDatabase = previous;
                }
                WriteMessage("\nDLSCAN_OK " + output);
            }
            catch (System.Exception ex)
            {
                WriteError(output, Path.GetFileName(input), "DWG_PARSE_FAILED", ex.Message);
                WriteMessage("\nDLSCAN_ERROR " + ex.Message);
            }
            finally
            {
                if (previous != null) HostApplicationServices.WorkingDatabase = previous;
            }
        }

        [CommandMethod("DLSCAN", CommandFlags.Session)]
        public void ScanActiveDocument()
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            var output = Environment.GetEnvironmentVariable("DRAWING_LIST_OUTPUT");
            if (doc == null)
            {
                WriteError(output, "", "NO_ACTIVE_DOCUMENT", "No active drawing is available.");
                return;
            }
            if (String.IsNullOrWhiteSpace(output)) output = Path.ChangeExtension(doc.Name, ".drawing-list.json");
            try
            {
                var json = ScanDatabase(doc.Database, Path.GetFileName(doc.Name), ReadTargetNames(), ReadNumberTag());
                File.WriteAllText(output, json, new UTF8Encoding(false));
                doc.Editor.WriteMessage("\nDLSCAN_OK " + output);
            }
            catch (System.Exception ex)
            {
                WriteError(output, Path.GetFileName(doc.Name), "DWG_PARSE_FAILED", ex.Message);
                doc.Editor.WriteMessage("\nDLSCAN_ERROR " + ex.Message);
            }
        }

        private static string[] ReadTargetNames()
        {
            var value = Environment.GetEnvironmentVariable("DRAWING_LIST_BLOCK_NAMES");
            if (String.IsNullOrWhiteSpace(value)) return new[] { "A1_TITLE_EN" };
            return value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }

        private static string ReadNumberTag()
        {
            var value = Environment.GetEnvironmentVariable("DRAWING_LIST_NUMBER_TAG");
            return String.IsNullOrWhiteSpace(value) ? "DWG_NUMBER" : value.Trim();
        }

        private static string ScanDatabase(Database db, string fileName, string[] targets, string numberTag)
        {
            var rows = new List<string>();
            var ordered = new List<Tuple<string, int, ObjectId>>();
            var blockCounts = new SortedDictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var blockTags = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            using (var tr = db.TransactionManager.StartTransaction())
            {
                var layouts = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
                foreach (DBDictionaryEntry entry in layouts)
                {
                    var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForRead);
                    if (!layout.ModelType) ordered.Add(Tuple.Create(layout.LayoutName, layout.TabOrder, layout.BlockTableRecordId));
                }
                tr.Commit();
            }

            foreach (var layout in ordered.OrderBy(x => x.Item2))
            {
                using (var tr = db.TransactionManager.StartTransaction())
                {
                    var space = (BlockTableRecord)tr.GetObject(layout.Item3, OpenMode.ForRead);
                    var matches = new List<BlockReference>();
                    var matchNames = new List<string>();
                    foreach (ObjectId id in space)
                    {
                        var block = tr.GetObject(id, OpenMode.ForRead, false) as BlockReference;
                        if (block == null) continue;
                        var defId = block.IsDynamicBlock ? block.DynamicBlockTableRecord : block.BlockTableRecord;
                        var def = tr.GetObject(defId, OpenMode.ForRead, false) as BlockTableRecord;
                        if (def == null || def.IsFromExternalReference || def.IsFromOverlayReference) continue;
                        if (!blockCounts.ContainsKey(def.Name))
                        {
                            blockCounts[def.Name] = 0;
                            blockTags[def.Name] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            // Inspect each definition once, even when a symbol
                            // has thousands of instances in the drawing.
                            foreach (ObjectId definitionId in def)
                            {
                                var definition = tr.GetObject(definitionId, OpenMode.ForRead, false) as AttributeDefinition;
                                if (definition != null) blockTags[def.Name].Add(definition.Tag ?? "");
                            }
                        }
                        blockCounts[def.Name]++;
                        foreach (ObjectId attrId in block.AttributeCollection)
                        {
                            var attribute = tr.GetObject(attrId, OpenMode.ForRead, false) as AttributeReference;
                            if (attribute != null) blockTags[def.Name].Add(attribute.Tag ?? "");
                        }
                        if (targets.Any(target => String.Equals(def.Name, target, StringComparison.OrdinalIgnoreCase)))
                        { matches.Add(block); matchNames.Add(def.Name); }
                    }

                    var warnings = new List<string>();
                    if (matches.Count == 0) warnings.Add("MISSING_TITLE_BLOCK");
                    if (matches.Count > 1) warnings.Add("MULTIPLE_TITLE_BLOCKS");
                    var attrs = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    if (matches.Count > 0)
                    {
                        var selected = matches[0];
                        var definition = (BlockTableRecord)tr.GetObject(selected.IsDynamicBlock ? selected.DynamicBlockTableRecord : selected.BlockTableRecord, OpenMode.ForRead);
                        foreach (ObjectId definitionId in definition)
                        {
                            var constant = tr.GetObject(definitionId, OpenMode.ForRead, false) as AttributeDefinition;
                            if (constant != null && constant.Constant) attrs[constant.Tag ?? ""] = constant.TextString ?? "";
                        }
                        foreach (ObjectId attrId in matches[0].AttributeCollection)
                        {
                            var attr = tr.GetObject(attrId, OpenMode.ForRead, false) as AttributeReference;
                            if (attr == null) continue;
                            var tag = attr.Tag ?? "";
                            var value = attr.TextString ?? "";
                            var resolved = ResolveLayoutDependentDrawingNumber(tag, value, layout.Item1, attr.HasFields, ordered.Select(x => x.Item1), numberTag);
                            attrs[tag] = resolved;
                            if (String.IsNullOrWhiteSpace(resolved)) warnings.Add("EMPTY_ATTRIBUTE:" + tag);
                        }
                    }
                    rows.Add(LayoutJson(layout.Item1, layout.Item2, matchNames.Count > 0 ? matchNames[0] : String.Join(", ", targets), matches.Count, attrs, warnings));
                    tr.Commit();
                }
            }
            var blocks = blockCounts.Select(x => "{\"name\":" + Q(x.Key) + ",\"count\":" + x.Value + ",\"tags\":[" + String.Join(",", blockTags[x.Key].OrderBy(tag => tag).Select(Q)) + "]}");
            return "{\"fileName\":" + Q(fileName) + ",\"status\":\"ok\",\"blocks\":[" + String.Join(",", blocks) + "],\"layouts\":[" + String.Join(",", rows) + "]}";
        }

        private static string LayoutJson(string layoutName, int tabOrder, string target, int count, SortedDictionary<string,string> attrs, List<string> warnings)
        {
            var pairs = attrs.Select(x => Q(x.Key) + ":" + Q(x.Value));
            return "{\"layout\":" + Q(layoutName) + ",\"layoutIndex\":" + tabOrder +
                ",\"titleBlock\":" + Q(target) + ",\"titleBlockCount\":" + count +
                ",\"included\":" + (count > 0 ? "true" : "false") + ",\"attributes\":{" + String.Join(",", pairs) +
                "},\"warnings\":[" + String.Join(",", warnings.Distinct().Select(Q)) + "]}";
        }

        private static void WriteError(string output, string fileName, string code, string message)
        {
            if (String.IsNullOrWhiteSpace(output)) return;
            var error = "{\"fileName\":" + Q(fileName) + ",\"status\":\"error\",\"error\":{\"code\":" + Q(code) + ",\"message\":" + Q(message) + "},\"layouts\":[]}";
            File.WriteAllText(output, error, new UTF8Encoding(false));
        }

        private static string ResolveLayoutDependentDrawingNumber(string tag, string value, string layoutName, bool hasFields, IEnumerable<string> layoutNames, string numberTag)
        {
            if (!hasFields || !String.Equals(tag, numberTag, StringComparison.OrdinalIgnoreCase)) return value;
            if (String.IsNullOrWhiteSpace(layoutName) || String.Equals(layoutName, "Model", StringComparison.OrdinalIgnoreCase)) return value;
            // A common title-block field is "L2-" + CTAB. When a DWG was last
            // saved from Model space, its cached field result is L2-Model. A
            // side-database scan intentionally does not activate layouts, so
            // rebuild that one layout-dependent token from the layout we are
            // already scanning instead of switching AutoCAD tabs.
            if (!Regex.IsMatch(layoutName, @"[A-Za-z].*[-_.]\d", RegexOptions.IgnoreCase)) return value;
            // CTAB fields can also contain the last paper-space layout that
            // AutoCAD evaluated (for example LF-203-1 in both LF-203 and
            // LF-203-1). Replace the longest known cached layout suffix with
            // the layout currently being scanned.
            var candidates = layoutNames.Concat(new[] { "Model" })
                .Where(x => !String.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(x => x.Length);
            foreach (var candidate in candidates)
            {
                if (value.EndsWith(candidate, StringComparison.OrdinalIgnoreCase))
                    return value.Substring(0, value.Length - candidate.Length) + layoutName;
            }
            return value;
        }

        private static void WriteMessage(string value)
        {
            var doc = Application.DocumentManager.MdiActiveDocument;
            if (doc != null) doc.Editor.WriteMessage(value);
        }

        private static string Q(string value)
        {
            if (value == null) return "null";
            var b = new StringBuilder("\"");
            foreach (var c in value)
            {
                switch (c)
                {
                    case '\\': b.Append("\\\\"); break;
                    case '"': b.Append("\\\""); break;
                    case '\r': b.Append("\\r"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\t': b.Append("\\t"); break;
                    default: if (c < 32) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c); break;
                }
            }
            return b.Append('"').ToString();
        }
    }
}
