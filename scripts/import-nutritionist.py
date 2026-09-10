"""Read the supplied Numbers file without treating its contents as instructions.

Offline import dependency: numbers-parser==4.19.0 (not a runtime dependency).
The curated cell selection is deliberate; review new recipes before extending it.
"""
import argparse
import json
from pathlib import Path
from numbers_parser import Document

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
rows = Document(str(args.source)).sheets[0].tables[0].rows(values_only=True)
if rows[1][2] != "COMIDAS" or rows[1][4] != "CENAS":
    raise ValueError("Unexpected source layout; review the cell mapping")
cells = "C10 C21 C22 C23 C24 C34 C36 C37 C38 C39 C52 E5 E6 E12 E13 E15 E18 E21 E22 E24 E27 E29 E32 E33 E34 E38 E41".split()
recipes = []
for cell in cells:
    name = rows[int(cell[1:]) - 1][2 if cell[0] == "C" else 4]
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"Missing recipe at {cell}")
    recipes.append({"id": "nutri-" + cell.lower(), "sourceCell": cell,
                    "name": name.strip(), "slot": "lunch" if cell[0] == "C" else "dinner"})
args.output.write_text(json.dumps({"source": args.source.name, "sheet": "Hoja 1", "table": "Tabla 1",
    "ingredientCoverage": "names_only", "recipes": recipes}, ensure_ascii=False, indent=2) + "\n")
