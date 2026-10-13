import asyncio, json
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(headless=True); c=await b.new_context(viewport={"width":1280,"height":1800}); pg=await c.new_page()
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    await pg.goto("http://localhost:8080/__mk-harness"); await pg.wait_for_timeout(8000)
    await pg.set_input_files('input[aria-label="Open PDF for markup"]','archde.pdf')
    layer=pg.get_by_test_id("markup-layer"); await layer.wait_for(timeout=30000); await pg.wait_for_timeout(1500)
    box=await layer.bounding_box(); X=box["x"]; Y=box["y"]
    async def dragv(x0,y0,x1,y1):
      await pg.mouse.move(X+x0,Y+y0); await pg.mouse.down(); await pg.mouse.move(X+x1,Y+y1,steps=6); await pg.mouse.up()
    async def tool(name): await pg.get_by_role("button",name=name,exact=True).click()
    await tool("Rectangle"); await dragv(100,100,250,180)
    await tool("Text box"); await dragv(300,100,500,150)
    await pg.get_by_label("Markup text").fill("Check flashing"); await pg.get_by_label("Markup text").blur()
    await tool("Arrow"); await dragv(100,300,300,400)
    await tool("Highlight"); await dragv(60,90,600,120)
    await tool("Revision cloud (double-click to finish)")
    for (x,y) in [(400,250),(600,250),(600,380)]: await pg.mouse.click(X+x,Y+y)
    await pg.mouse.dblclick(X+400,Y+380)
    await tool("Callout (drag from the point to the box)"); await dragv(700,300,850,220)
    await tool("Sticky note / comment"); await pg.mouse.click(X+900,Y+100)
    await pg.get_by_label("Reply").fill("Looks good"); await pg.keyboard.press("Enter")
    await tool("Stamp"); await pg.mouse.click(X+800,Y+450)
    # select rect and move it
    await tool("Select / move"); await dragv(101,140,201,240)
    n_before=await pg.locator('[data-markup]').count()
    await pg.keyboard.press("Control+z"); await pg.keyboard.press("Control+Shift+z")
    await pg.screenshot(path="mk1.png")
    await pg.get_by_role("button",name="Save new version").click(); await pg.wait_for_function("window.__out",timeout=20000)
    res=await pg.evaluate("""async()=>{const pdfjs=await import('/node_modules/.vite/deps/pdfjs-dist.js');const d=await pdfjs.getDocument({data:window.__out.slice()}).promise;const p=await d.getPage(1);const a=await p.getAnnotations();return a.map(x=>x.subtype+(x.inReplyTo?'(reply)':''))}""")
    print("drawn:",n_before,"pdfjs annots:",res,"errors:",errs[:3])
    # page 2 rotated
    await pg.get_by_role("button",name="Next page").click(); await pg.wait_for_timeout(1500)
    await tool("Text box"); await dragv(100,100,300,150); await pg.wait_for_timeout(300)
    await pg.screenshot(path="mk2.png")
    await b.close()
asyncio.run(main())
