"""Inline src/ into one self-contained page.
   dist/artifact.html  – body-only page for the claude.ai Artifact host
   index.html          – full HTML document for GitHub Pages / local open
"""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
shell = (src / "shell.html").read_text()
page = (shell.replace("/*__CSS__*/", (src / "styles.css").read_text())
             .replace("/*__DATA__*/", (src / "data.js").read_text())
             .replace("/*__APP__*/", (src / "app.js").read_text()))

(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "artifact.html").write_text(page)

head, _, rest = page.partition("<style>")
doc = ("<!doctype html>\n<html lang=\"en-AU\">\n<head>\n<meta charset=\"utf-8\">\n"
       "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
       + head + "<style>" + rest.split("</style>", 1)[0] + "</style>\n</head>\n<body>\n"
       + rest.split("</style>", 1)[1] + "\n</body>\n</html>\n")
(root / "index.html").write_text(doc)
print("built", len(page) // 1024, "KB")
