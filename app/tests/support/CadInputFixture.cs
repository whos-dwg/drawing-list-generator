using System;
using System.IO;
using System.Collections.Generic;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;

public class CadInputFixture
{
    [CommandMethod("DLCREATEFIXTURE")]
    public void Create()
    {
        var output = Environment.GetEnvironmentVariable("DRAWING_LIST_TEST_FIXTURE");
        using (var db = new Database(true, true))
        {
        using (var tr = db.TransactionManager.StartTransaction())
        {
            var table = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForWrite);
            var custom = CreateBlock(table, tr, "CONSULTANT_FRAME", new[] { "SHEET_ID", "PROJECT", "TITLE_EN", "TITLE_CN" });
            var standard = CreateBlock(table, tr, "A1_TITLE_EN", new[] { "DWG_NUMBER", "DRAWING_TITLE_1", "DRAWING_TITLE_3" });
            var layouts = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
            foreach (DBDictionaryEntry entry in layouts)
            {
                var layout = (Layout)tr.GetObject(entry.Value, OpenMode.ForWrite);
                if (layout.ModelType) continue;
                layout.LayoutName = layout.TabOrder == 1 ? "LF-203" : "LF-203-1";
                var space = (BlockTableRecord)tr.GetObject(layout.BlockTableRecordId, OpenMode.ForWrite);
                Insert(space, custom, tr, new Dictionary<string,string> {
                    { "SHEET_ID", "L2-" + layout.LayoutName }, { "PROJECT", "Custom Restaurant" },
                    { "TITLE_EN", "LOOSE FURNITURE DETAILS" }, { "TITLE_CN", "Furniture Detail" }
                });
                Insert(space, standard, tr, new Dictionary<string,string> {
                    { "DWG_NUMBER", "HBA-" + layout.LayoutName }, { "DRAWING_TITLE_1", "Existing HBA" }, { "DRAWING_TITLE_3", "MILLWORK DETAILS" }
                });
            }
            tr.Commit();
        }
        db.SaveAs(output, DwgVersion.Current);
        }
    }

    private static BlockTableRecord CreateBlock(BlockTable table, Transaction tr, string name, string[] tags)
    {
        var definition = new BlockTableRecord { Name = name };
        table.Add(definition); tr.AddNewlyCreatedDBObject(definition, true);
        int y = 0;
        foreach (var tag in tags)
        {
            var attr = new AttributeDefinition { Tag = tag, Prompt = tag, TextString = "", Height = 2.5, Position = new Point3d(0, y++, 0) };
            definition.AppendEntity(attr); tr.AddNewlyCreatedDBObject(attr, true);
        }
        var constant = new AttributeDefinition { Tag = "CONST_NOTE", TextString = "CONSTANT ATTRIBUTE", Constant = true, Height = 2.5 };
        definition.AppendEntity(constant); tr.AddNewlyCreatedDBObject(constant, true);
        return definition;
    }

    private static void Insert(BlockTableRecord space, BlockTableRecord definition, Transaction tr, Dictionary<string,string> values)
    {
        var block = new BlockReference(Point3d.Origin, definition.ObjectId);
        space.AppendEntity(block); tr.AddNewlyCreatedDBObject(block, true);
        foreach (ObjectId id in definition)
        {
            var source = tr.GetObject(id, OpenMode.ForRead) as AttributeDefinition;
            if (source == null || source.Constant) continue;
            var attr = new AttributeReference(); attr.SetAttributeFromBlock(source, block.BlockTransform);
            attr.TextString = values[source.Tag]; block.AttributeCollection.AppendAttribute(attr); tr.AddNewlyCreatedDBObject(attr, true);
        }
    }
}
