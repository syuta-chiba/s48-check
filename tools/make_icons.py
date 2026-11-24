"""アイコン (icon-180/192/512.png) を作り直す。  python tools/make_icons.py
Playwright（Python）で HTML を描いて PNG にする。"""
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent
with sync_playwright() as pw:
    b = pw.chromium.launch(); p = b.new_page()
    for s in (180, 192, 512):
        p.set_viewport_size({"width": s, "height": s})
        p.set_content(f'''<body style="margin:0;width:{s}px;height:{s}px;background:#1d1d1f;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;color:#fff">
<div style="font-size:{s*.26}px;font-weight:800"><span style="color:#2ecc71">○</span><span style="color:#ff5a52">×</span><span style="color:#ffbf1f">△</span></div>
<div style="font-size:{s*.15}px;font-weight:700;margin-top:{s*.04}px">s1-48</div></body>''')
        p.screenshot(path=str(OUT / f"icon-{s}.png"))
    b.close()
print("ok")
