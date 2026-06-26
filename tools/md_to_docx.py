from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
import re

MD_FILE = "/Users/mohammedkassem/Documents/hollow-knight-map-02/presentatie-plan.md"
OUT_FILE = "/Users/mohammedkassem/Documents/hollow-knight-map-02/presentatie-plan.docx"

doc = Document()

# Remove default empty paragraph
for p in doc.paragraphs:
    p._element.getparent().remove(p._element)

def add_paragraph(doc, text="", style="Normal"):
    p = doc.add_paragraph(style=style)
    return p

def parse_inline(run_text):
    """Return list of (text, bold, code) tuples from inline markdown."""
    parts = []
    pattern = re.compile(r'`([^`]+)`|\*\*([^*]+)\*\*')
    last = 0
    for m in pattern.finditer(run_text):
        if m.start() > last:
            parts.append((run_text[last:m.start()], False, False))
        if m.group(1) is not None:
            parts.append((m.group(1), False, True))
        elif m.group(2) is not None:
            parts.append((m.group(2), True, False))
        last = m.end()
    if last < len(run_text):
        parts.append((run_text[last:], False, False))
    return parts

def add_rich_paragraph(doc, text, style="Normal"):
    p = doc.add_paragraph(style=style)
    for chunk, bold, code in parse_inline(text):
        run = p.add_run(chunk)
        run.bold = bold
        if code:
            run.font.name = "Courier New"
            run.font.size = Pt(10)
    return p

with open(MD_FILE, "r") as f:
    lines = f.readlines()

i = 0
while i < len(lines):
    line = lines[i].rstrip("\n")

    # Heading 1
    if line.startswith("# ") and not line.startswith("## "):
        p = doc.add_heading(line[2:], level=1)
        i += 1

    # Heading 2
    elif line.startswith("## ") and not line.startswith("### "):
        p = doc.add_heading(line[3:], level=2)
        i += 1

    # Heading 3
    elif line.startswith("### "):
        p = doc.add_heading(line[4:], level=3)
        i += 1

    # Horizontal rule
    elif line.strip() == "---":
        i += 1

    # Code block
    elif line.startswith("```"):
        i += 1
        code_lines = []
        while i < len(lines) and not lines[i].startswith("```"):
            code_lines.append(lines[i].rstrip("\n"))
            i += 1
        i += 1
        p = doc.add_paragraph("\n".join(code_lines))
        p.style = doc.styles["Normal"]
        for run in p.runs:
            run.font.name = "Courier New"
            run.font.size = Pt(9)

    # Table
    elif line.startswith("|"):
        table_lines = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            table_lines.append(lines[i].rstrip("\n"))
            i += 1
        # Filter separator rows
        rows = [r for r in table_lines if not re.match(r'^\|[-| :]+\|$', r.strip())]
        if not rows:
            continue
        cols = [c.strip() for c in rows[0].strip("|").split("|")]
        table = doc.add_table(rows=len(rows), cols=len(cols))
        table.style = "Table Grid"
        for ri, row_text in enumerate(rows):
            cells = [c.strip() for c in row_text.strip("|").split("|")]
            for ci, cell_text in enumerate(cells):
                if ci < len(table.rows[ri].cells):
                    cell = table.rows[ri].cells[ci]
                    cell.text = ""
                    p = cell.paragraphs[0]
                    for chunk, bold, code in parse_inline(cell_text):
                        run = p.add_run(chunk)
                        run.bold = bold or (ri == 0)
                        if code:
                            run.font.name = "Courier New"
                            run.font.size = Pt(9)
        doc.add_paragraph()

    # Bullet list
    elif re.match(r'^- ', line):
        text = line[2:]
        add_rich_paragraph(doc, text, style="List Bullet")
        i += 1

    # Numbered list
    elif re.match(r'^\d+\. ', line):
        text = re.sub(r'^\d+\. ', '', line)
        add_rich_paragraph(doc, text, style="List Number")
        i += 1

    # Empty line
    elif line.strip() == "":
        i += 1

    # Normal paragraph
    else:
        add_rich_paragraph(doc, line)
        i += 1

doc.save(OUT_FILE)
print(f"Saved: {OUT_FILE}")
