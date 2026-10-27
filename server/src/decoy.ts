export const decoyHtml = (title = 'Alex Rivera — Photography Portfolio') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff}
header{position:sticky;top:0;background:rgba(255,255,255,.8);backdrop-filter:blur(8px);border-bottom:1px solid #eee;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
nav a{margin-left:18px;color:#333;text-decoration:none;font-weight:500}
.hero{max-width:1100px;margin:40px auto;padding:0 24px;display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:center}
.hero h1{font-size:42px;line-height:1.1;margin:0}
.hero p{color:#555;line-height:1.6}
.hero img{width:100%;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.12)}
.grid{max-width:1100px;margin:20px auto;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card img{width:100%;height:220px;object-fit:cover;border-radius:12px}
footer{padding:40px 24px;text-align:center;color:#888;border-top:1px solid #eee;margin-top:40px}
.btn{display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;margin-top:12px}
.badge{display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;padding:6px 10px;border-radius:999px;font-size:12px;color:#334155}
</style>
</head>
<body>
<header>
  <div style="font-weight:800;letter-spacing:.2px">${title.split(' —')[0]} <span style="font-weight:400;color:#64748b">Studio</span></div>
  <nav><a href="#">Work</a><a href="#">About</a><a href="#">Contact</a></nav>
</header>
<section class="hero">
 <div>
  <span class="badge">Available for commissions — Fall 2026</span>
  <h1>Light, captured<br/>honestly &amp; quietly.</h1>
  <p>Film & digital photography based in Montréal. Natural light portraiture, documentary, and quiet urban landscapes. This site is a personal portfolio — nothing to see here, just photos.</p>
  <a class="btn" href="#">View Recent Work</a>
  <p style="font-size:12px;color:#94a3b8;margin-top:12px">Served securely via OpenPath CDN • TLS 1.3 • Cache HIT</p>
 </div>
 <img src="https://images.unsplash.com/photo-1493860607057-0d3b4b5a24b7?q=80&w=1200&auto=format&fit=crop" alt="hero"/>
</section>
<section class="grid">
  <div class="card"><img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&q=80&auto=format&fit=crop"/><p style="font-weight:600;margin:8px 0 2px">Urban Stillness</p><p style="color:#64748b;font-size:14px;margin:0">Streets at dawn, Montréal — 2024</p></div>
  <div class="card"><img src="https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=800&q=80&auto=format&fit=crop"/><p style="font-weight:600;margin:8px 0 2px">Lake Memory</p><p style="color:#64748b;font-size:14px;margin:0">Laurentides, Québec — 2023</p></div>
  <div class="card"><img src="https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80&auto=format&fit=crop"/><p style="font-weight:600;margin:8px 0 2px">Neon Quiet</p><p style="color:#64748b;font-size:14px;margin:0">Downtown, night study</p></div>
</section>
<footer>© 2026 ${title.split(' —')[0]} — All rights reserved. • <a href="#" style="color:#888">Privacy</a> • Served from YUL edge (cache).</footer>
</body>
</html>`;
