"""ブラウザで動かして確かめるテスト。GitHub は本物を使わず、ここで模擬する（本物のトークンは使わない）。

    python tests/e2e.py            # 失敗すると AssertionError で止まる
    python tests/e2e.py --shots    # /tmp/study-*.png に画面を保存

必要なもの: Python の playwright（chromium）。リポジトリ直下を http で配信して開く。
"""
import base64, json, re, sys, threading, time, functools, http.server
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = "--shots" in sys.argv
NOW = int(time.time() * 1000); D = 86400000

# ---- リポジトリを配信 ----
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(ROOT))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

# ---- 模擬 GitHub（contents API） ----
TOKEN = "github_pat_TEST"
files = {}; writes = [0]
def gh(route):
    req = route.request; h = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if req.headers.get("authorization") != "Bearer " + TOKEN:
        return route.fulfill(status=401, body='{"message":"Bad credentials"}', headers=h)
    m = re.search(r"/contents/([^?]+)", req.url)
    if not m: return route.fulfill(status=200, body='{"full_name":"x/study-data"}', headers=h)
    path = m.group(1); f = files.get(path)
    if req.method == "GET":
        if not f: return route.fulfill(status=404, body='{"message":"Not Found"}', headers=h)
        return route.fulfill(status=200, body=json.dumps({"sha": f[0], "content": base64.b64encode(f[1].encode()).decode()}), headers=h)
    body = json.loads(req.post_data)
    if f and body.get("sha") != f[0]: return route.fulfill(status=409, body='{"message":"conflict"}', headers=h)
    writes[0] += 1; files[path] = (f"sha{writes[0]}", base64.b64decode(body["content"]).decode())
    return route.fulfill(status=200, body=json.dumps({"content": {"sha": files[path][0]}}), headers=h)

# 前の版（s1〜s48 だけのアプリ）の記録
V1 = {"cur": 0, "parts": {"s4": 2}, "rounds": [{"name": "1回目", "running": None, "items": {
    "s1": {"t": 267000, "m": "t", "at": NOW - D}, "s2": {"t": 430000, "m": "o", "at": NOW - D},
    "s4-1": {"t": 766000, "m": "t", "at": NOW}, "s5": {"t": 2524000, "m": "x", "at": NOW}}}]}

def shot(p, name):
    if SHOTS: p.screenshot(path=f"/tmp/study-{name}.png", full_page=True)

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def device():
        c = br.new_context(viewport={"width": 390, "height": 844}); c.route("https://api.github.com/**", gh)
        p = c.new_page(); errs = []
        p.on("pageerror", lambda e: errs.append(str(e))); p.errs = errs
        p.goto(URL); return p
    ev = lambda p, js, arg=None: p.evaluate(js, arg) if arg is not None else p.evaluate(js)

    # 1. 前の版の記録を引き継ぐ
    p = device(); ev(p, "d=>{localStorage.clear(); localStorage.setItem('s48-check-v1', JSON.stringify(d))}", V1); p.reload()
    assert ev(p, "db.v") == 2 and ev(p, "db.books[0].name") == "s1〜s48"
    assert ev(p, "unitIds(db.books[0]).length") == 49, "s4 が (1)(2) に分かれている"
    assert ev(p, "db.log.length") == 4, "問題の時間から勉強時間の記録を作る"
    shot(p, "home")

    # 2. 科目・教材・締切
    p.click('#tabs [data-tab="set"]'); p.click('#v-set [data-act="addSubjects"]')
    assert ev(p, "db.subjects.length") == 6
    p.click('#tabs [data-tab="books"]'); p.click('.book'); p.click('[data-act="editBook"]')
    p.select_option('#form select', ev(p, "db.subjects.find(s=>s.name==='数学').id"))
    p.fill('#form input[type=date]', time.strftime('%Y-%m-%d', time.localtime(time.time() + 20 * 86400)))
    p.click('[data-f="ok"]')
    assert ev(p, "S(db.books[0].subjectId).name") == "数学"
    assert all(ev(p, "db.log.map(l=>S(l.sub).name)")[i] == "数学" for i in range(4)), "教材の科目を変えると勉強時間も付け替える"

    # 3. 問題のストップウォッチと ○×△
    p.click('.tile[data-q="s6"]'); p.click('#startQ'); p.wait_for_timeout(1200)
    assert ev(p, "db.running.q") == "s6"
    p.click('.dm.o'); assert ev(p, "db.running") is None, "印を付けたら止まる"
    it = ev(p, "db.books[0].rounds[0].items.s6"); assert it["m"] == "o" and it["t"] >= 1000 and it["at"]
    p.click('[data-act="resetQ"]'); assert ev(p, "db.books[0].rounds[0].items.s6.t") == 0
    # 小問に分ける → (1) に移る
    p.once("dialog", lambda d: d.accept("3")); p.click('#dSplit')
    assert ev(p, "openQ") == "s6-1" and ev(p, "db.books[0].rounds[0].items['s6-1'].m") == "o"
    p.click('[data-act="closeDetail"]'); shot(p, "book")
    p.click('[data-act="openAna"]'); shot(p, "ana"); p.click('[data-act="closeAna"]'); p.click('[data-act="closeBook"]')

    # 4. 問題なしの勉強（科目タイマー）と手入力
    p.click('#tabs [data-tab="home"]'); p.click('.subjbtn >> nth=1'); p.wait_for_timeout(1100)
    assert ev(p, "db.running.type") == "free"; p.click('.runcard [data-act="stopRun"]')
    p.click('#tabs [data-tab="log"]'); p.click('[data-act="addManual"]')
    p.fill('#form input[data-i="3"]', '45'); p.click('[data-f="ok"]')
    assert ev(p, "db.log.some(l=>l.manual && l.ms===45*60000)")
    p.click('.chart .col >> nth=13'); assert "合計" in p.inner_text('#tip')
    shot(p, "log")

    # 5. GitHub に保存（間違ったトークン → 正しいトークン）
    p.click('#tabs [data-tab="set"]'); p.click('[data-act="syncSetup"]')
    p.fill('#form input[type=password]', 'bad'); p.click('[data-f="ok"]'); p.wait_for_timeout(800)
    assert "トークン" in ev(p, "Sync.cfg.err")
    p.click('[data-act="syncSetup"]'); p.fill('#form input[type=password]', TOKEN); p.click('[data-f="ok"]'); p.wait_for_timeout(1500)
    assert ev(p, "Sync.cfg.err") is None and "data.json" in files and "README.md" in files
    assert "## 数学：s1〜s48" in files["README.md"][1] and "| s5 | × 42:04" in files["README.md"][1]
    shot(p, "set")

    # 6. 別の端末（空）で開く → GitHub から読み込む
    q = device(); ev(q, "t=>{localStorage.clear(); localStorage.setItem('study-sync-v1', JSON.stringify({token:t}))}", TOKEN); q.reload(); q.wait_for_timeout(1200)
    assert ev(q, "db.subjects.length") == 6
    ev(q, "db.goalMin = 180; save(); Sync.sync(true)"); q.wait_for_timeout(1200)
    ev(p, "document.dispatchEvent(new Event('visibilitychange'))"); p.wait_for_timeout(1200)
    assert ev(p, "db.goalMin") == 180, "もう一方の端末の変更を読み込む"

    # 7. 履歴を消した端末で先に触ってからつなぐ → どちらを残すか聞く
    r = device(); ev(r, "localStorage.clear()"); r.reload(); ev(r, "db.subjects.push({id:'z',name:'テスト',slot:0}); save()")
    asked = []
    r.once("dialog", lambda d: (asked.append(d.message), d.accept()))
    ev(r, f"Sync.cfg.token='{TOKEN}'; Sync.store(); Sync.sync()"); r.wait_for_timeout(1200)
    assert asked and ev(r, "db.subjects.length") == 6, "GitHub の記録を読み込む"

    # 8. 空の端末からは GitHub に保存しない
    files.clear(); s = device(); ev(s, f"localStorage.clear(); localStorage.setItem('study-sync-v1', JSON.stringify({{token:'{TOKEN}'}}))"); s.reload(); s.wait_for_timeout(1200)
    assert "data.json" not in files

    for x in (p, q, r, s): assert not x.errs, x.errs
    br.close()
srv.shutdown()
print("all ok")
