"""claude.ai 아티팩트용 단일 페이지를 만듭니다 (CSS·JS 인라인, 이미지·음원은 별도 파일).

사용법: python3 tools/build_artifact.py [출력 폴더]
출력 폴더(기본 .artifact-build/)의 index.html 을 아티팩트로 게시하고,
files 목록(files.json)에 있는 assets/ 경로를 함께 올립니다.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, ".artifact-build")
os.makedirs(OUT, exist_ok=True)
read = lambda p: open(os.path.join(ROOT, p), encoding="utf-8").read()

src = read("index.html")
title = re.search(r"<title>.*?</title>", src).group(0)
fonts = re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^"]+"[^>]*>', src)
body = src.split("<!--PAGE-START-->")[1].split("<!--PAGE-END-->")[0]

def inline(path, pre=""):
    return pre + "<script>\n" + read(path).replace("</script", "<\\/script") + "\n</script>"

for name in ("voice-data", "sky", "voice"):
    body = body.replace(f'<script src="assets/js/{name}.js"></script>', inline(f"assets/js/{name}.js"))
body = body.replace('<script src="assets/js/main.js"></script>', inline("assets/js/main.js", "<script>window.__ARTIFACT__ = true;</script>\n"))
assert 'src="assets/js/' not in body, "inline step missed a script"

def css_inline(path):
    # relative font/image urls are written against the stylesheet's folder; re-anchor them on the page
    base = os.path.dirname(path)
    def fix(m):
        u = m.group(1).strip("'\"")
        if re.match(r"(data:|https?:|/|#)", u):
            return m.group(0)
        return "url(" + os.path.normpath(os.path.join(base, u)).replace(os.sep, "/") + ")"
    return re.sub(r"url\(([^)]+)\)", fix, read(path))

local_css = re.findall(r'<link rel="stylesheet" href="(assets/[^"]+\.css)">', src)
assert "assets/css/main.css" in local_css, "main.css link missing"
page = "\n".join([title] + fonts + ["<style>\n" + "\n".join(css_inline(p) for p in local_css) + "\n</style>", body.strip()]) + "\n"
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(page)

files = []
for sub in ("assets/img", "assets/img/yt", "assets/audio"):
    for fn in sorted(os.listdir(os.path.join(ROOT, sub))):
        if fn.endswith((".webp", ".mp3")):
            files.append({"path": f"{sub}/{fn}"})
for fn in sorted(os.listdir(os.path.join(ROOT, "assets/fonts/pretendard"))):
    if fn.endswith(".woff2"):
        files.append({"path": f"assets/fonts/pretendard/{fn}", "contentType": "font/woff2"})
files.append({"path": "assets/fonts/pretendard/LICENSE.txt", "contentType": "text/plain"})
json.dump(files, open(os.path.join(OUT, "files.json"), "w"), ensure_ascii=False, indent=0)
print(f"{OUT}/index.html · {len(page)//1024}KB · {len(files)} files")
