// Midnight Gold v2: the four surfaces that were partial (18–21): lots &
// reconciliation, daily close, drivers, backup & recovery. Same helpers and
// conventions as screens-ops.cjs (main state + a "States on this page" board).
module.exports = function screensOps2(h) {
  const { T, lbp, usd, icon, dirIcon, capsule, shell, seg, moneyIn, chips, state, board, empty, denied, errLine, kv, statusBadge, head, closeBtn, search, select, input } = h
  const S = {}
  const synced = capsule("ok", T("Synced 1 min ago", "تمت المزامنة منذ دقيقة"))
  const STOCK_TABS = [["p", T("Products", "المنتجات")], ["l", T("Lots & counts", "الدفعات والجرد")], ["r", T("Receiving", "الاستلام")], ["s", T("Suppliers", "الموردون")]]
  const MONEY_TABS = [["t", T("Today", "اليوم")], ["s", T("Shift & drawer", "الوردية والصندوق")], ["e", T("Expenses", "المصاريف")], ["c", T("Customers & debt", "الزبائن والديون")], ["r", T("Reports", "التقارير")]]
  const ADMIN_TABS = [["t", T("Team & permissions", "الفريق والصلاحيات")], ["s", T("Store settings", "إعدادات المتجر")], ["d", T("Devices & sync", "الأجهزة والمزامنة")], ["b", T("Backup & recovery", "النسخ والاستعادة")], ["a", T("About & updates", "حول والتحديثات")]]
  const td = (label, html, cls = "") => `<td data-label="${label}"${cls ? ` class="${cls}"` : ""}>${html}</td>`

  // ── 18 Lots & reconciliation ──────────────────────────────────────────────
  const recon = [
    [T("Almarai Laban 1 L", "لبن المراعي 1 ل"), 27, 27, "ok", T("Matches", "مطابق")],
    [T("Kitkat 4 finger", "كيت كات 4 أصابع"), 8, 6, "info", T("2 untracked returns", "مرتجعان غير متتبَّعين")],
    [T("Picon Cheese 8 pcs", "جبنة بيكون 8 قطع"), 41, 44, "err", T("Lots hold 3 more", "الدفعات أكثر بـ 3")],
    [T("Arabic bread", "خبز عربي"), 60, 0, "mute", T("Not lot-tracked", "غير متتبَّع بالدفعات")],
    [T("Bonjus Orange 1 L", "بونجوس برتقال 1 ل"), 12, 14, "err", T("Lots hold 2 more", "الدفعات أكثر بـ 2")],
  ]
  const reconBadge = { ok: ["ok", "check"], info: ["info", "info"], err: ["err", "circle-alert"], mute: ["mute", "minus"] }
  S["18-lots-reconciliation"] = {
    title: T("Stock · lots & reconciliation", "المخزون · الدفعات والمطابقة"),
    body: shell({
      active: "stock", crumb: T("Stock", "المخزون"), page: T("Lots & counts", "الدفعات والجرد"), tabs: STOCK_TABS, activeTab: "l",
      actions: `<button class="btn btn-sm">${icon("clipboard-check", 16)}${T("Start a count", "بدء جرد")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="kpis">${[[T("Products checked", "منتجات فُحصت"), "1,284", "", ""], [T("Stock matches lots", "المخزون مطابق للدفعات"), "1,251", "ok", "check"], [T("Explained differences", "فروقات مفسَّرة"), "21", "info", "info"], [T("Need review", "بحاجة لمراجعة"), "12", "err", "circle-alert"]].map(([l, v, t, ic]) => `<div class="card" style="padding:16px"><div class="flex items-center justify-between"><span class="cap">${l}</span>${t ? `<span class="badge t-${t}">${icon(ic, 12)}</span>` : ""}</div><div class="stat num" style="margin-top:6px">${v}</div></div>`).join("")}</div>
      <div class="cols-2">
        <section class="card" style="overflow:hidden" aria-labelledby="rc-h">
          ${head(`<span id="rc-h">${T("Stock vs lots", "المخزون مقابل الدفعات")}</span>`, T("Checked against lots and the movement ledger · today 07:58", "مقارنة بالدفعات وسجل الحركات · اليوم 07:58"), `<div class="flex gap-2" role="group" aria-label="${T("Filter", "تصفية")}">${chips([[T("Need review", "بحاجة لمراجعة"), "12", "err"], [T("Explained", "مفسَّرة"), "21"], [T("All", "الكل")]])}</div>`)}
          <div class="scroll-x"><table class="tbl prio" style="min-width:0"><thead><tr><th>${T("Product", "المنتج")}</th><th class="r">${T("On hand", "المتوفر")}</th><th class="r col-opt">${T("In lots", "في الدفعات")}</th><th>${T("Finding", "النتيجة")}</th><th class="col-opt"><span class="sr-only">${T("Action", "إجراء")}</span></th></tr></thead><tbody>
          ${recon.map(([n, onHand, inLots, tone, text], i) => `<tr class="${i === 1 ? "sel" : ""}"><td class="font-semibold">${n}</td><td class="r num">${onHand}</td><td class="r num col-opt" style="color:var(--text-2)">${inLots}</td><td><span class="badge t-${reconBadge[tone][0]}">${icon(reconBadge[tone][1], 12)}${text}</span></td><td class="col-opt">${tone === "err" ? `<button class="btn btn-sm">${T("Review", "مراجعة")}</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="ex-h">
          ${head(`<span id="ex-h">${T("Kitkat 4 finger · 2 untracked returns", "كيت كات 4 أصابع · مرتجعان غير متتبَّعين")}</span>`, T("Explained: not an error", "مفسَّر: ليس خطأ"), closeBtn())}
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
            ${kv([[T("On hand", "المتوفر"), "8"], [T("In lots", "في الدفعات"), "6 · L-0790"], [T("Untracked", "غير متتبَّع"), "2"]])}
            <div class="inset" style="padding:12px;display:flex;flex-direction:column;gap:6px"><div class="font-semibold">${T("Where the 2 units came from", "من أين جاءت الوحدتان")}</div><div class="cap">${T("Refund R-30388 returned 2 units of a sale made before lots were recorded. The till never invents a lot for them.", "أعاد المرتجع R-30388 وحدتين من بيع سبق تسجيل الدفعات. لا يخترع الصندوق دفعة لهما.")}</div></div>
            <div class="inset" style="padding:12px;display:flex;flex-direction:column;gap:6px"><div class="font-semibold">${T("Can they be sold?", "هل يمكن بيعهما؟")}</div><div class="cap">${T("Yes. Checkout sells lots first (first expiry first), then these 2 as untracked stock. Stock never goes below zero.", "نعم. يبيع الدفع الدفعات أولاً (الأقرب انتهاءً)، ثم هاتين الوحدتين كمخزون غير متتبَّع. لا ينزل المخزون تحت الصفر.")}</div></div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("history", 14)}${T("Movement history", "سجل الحركات")}</button><button class="btn btn-primary btn-sm" style="margin-inline-start:auto">${icon("package-plus", 14)}${T("Put into a lot", "إدخالهما في دفعة")}</button></div>
          </div>
        </section>
      </div>
      <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px" aria-labelledby="ct-h">
        <div class="flex items-center gap-2" style="flex-wrap:wrap"><h2 id="ct-h" class="sub" style="margin:0">${T("Count in progress", "جرد قيد التنفيذ")} · <span class="num">COUNT-7Q2K-00004</span></h2>${statusBadge("info", "clipboard-check", T("214 of 1,284 counted", "جُرد 214 من 1,284"))}<span class="cap" style="margin-inline-start:auto">${T("Started 07:40 by Ali · Register 1", "بدأه علي الساعة 07:40 · الصندوق 1")}</span></div>
        <div style="height:6px;border-radius:999px;background:var(--surface-3)" role="progressbar" aria-valuenow="17" aria-valuemax="100" aria-label="${T("Count progress", "تقدم الجرد")}"><div style="width:17%;height:6px;border-radius:999px;background:var(--info)"></div></div>
        <div class="flex gap-2" style="flex-wrap:wrap"><span class="cap">${T("Variance so far: −4 units · −$6.80 at cost", "الفرق حتى الآن: −4 وحدات · −6.80$ بسعر الكلفة")}</span><span style="margin-inline-start:auto" class="flex gap-2"><button class="btn btn-sm">${T("Continue counting", "متابعة الجرد")}</button><button class="btn btn-sm">${T("Finish and post", "إنهاء وترحيل")}</button></span></div>
      </section>
      ${board([
        state("dialog", T("Post count COUNT-7Q2K-00004?", "ترحيل الجرد COUNT-7Q2K-00004؟"), `
          <div class="cap">${T("Each difference becomes one stock adjustment (reason: Count correction). Lots move first expiry first.", "يصبح كل فرق تعديلاً للمخزون (السبب: تصحيح جرد). تتحرك الدفعات بالأقرب انتهاءً أولاً.")}</div>
          ${[[T("Picon Cheese 8 pcs", "جبنة بيكون 8 قطع"), "41 → 38", "−3"], [T("Pepsi 330 ml", "بيبسي 330 مل"), "214 → 213", "−1"], [T("Kitkat 4 finger", "كيت كات 4 أصابع"), "8 → 8", "0"]].map(([n, c, d]) => `<div class="flex items-center gap-3"><span style="flex:1">${n}</span><span class="num cap">${c}</span><span class="num font-semibold" style="width:40px;text-align:end">${d}</span></div>`).join("")}
          ${kv([[T("Total", "المجموع"), T("−4 units · −$6.80", "−4 وحدات · −6.80$")]])}`,
          `<button class="btn">${T("Keep counting", "متابعة الجرد")}</button><button class="btn btn-primary">${T("Post 2 adjustments", "ترحيل تعديلين")}</button>`),
        state("error", T("Stock moved during the count", "تحرك المخزون أثناء الجرد"), `<div class="banner t-err" role="alert">${icon("circle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("3 products were sold after you counted them", "بيعت 3 منتجات بعد جردها")}</div><div class="cap" style="color:var(--text-2)">${T("Their expected quantity changed, so the difference would be wrong. Recount just these 3.", "تغيرت كميتها المتوقعة فيصبح الفرق خاطئاً. أعد جرد هذه الثلاثة فقط.")}</div></div></div>`, `<button class="btn btn-primary btn-sm">${T("Recount 3 products", "إعادة جرد 3 منتجات")}</button>`),
        state("empty", T("Everything matches", "كل شيء مطابق"), empty("circle-check", T("Stock matches lots for all 1,284 products", "المخزون مطابق للدفعات لكل المنتجات الـ 1,284"), T("Checked today at 07:58.", "فُحص اليوم الساعة 07:58."), `<button class="btn btn-sm">${icon("refresh-cw", 14)}${T("Check again", "تحقق مجدداً")}</button>`)),
        state("permission", T("Cashiers count; managers post", "الكاشير يجرد والمدير يرحّل"), `<div class="flex items-center gap-2" style="flex-wrap:wrap"><button class="btn btn-sm" disabled aria-describedby="post-perm">${icon("lock", 14)}${T("Finish and post", "إنهاء وترحيل")}</button><span id="post-perm" class="cap">${T("Posting changes stock. Needs the Adjust stock permission.", "الترحيل يغيّر المخزون. يتطلب صلاحية تعديل المخزون.")}</span></div>`),
      ])}`,
    }),
  }

  // ── 19 Daily close ────────────────────────────────────────────────────────
  const steps = [[T("Shifts", "الورديات"), "done"], [T("Count the drawer", "عدّ الصندوق"), "on"], [T("Review", "المراجعة"), ""], [T("Close", "الإقفال"), ""]]
  S["19-daily-close"] = {
    title: T("Money · close the day", "المال · إقفال اليوم"),
    body: shell({
      active: "money", crumb: T("Money › Shift & drawer", "المال › الوردية والصندوق"), page: T("Close the day · Fri 16 Oct", "إقفال اليوم · الجمعة 16 تشرين الأول"), tabs: MONEY_TABS, activeTab: "s",
      capsuleHtml: synced,
      content: `
      <nav aria-label="${T("Close steps", "خطوات الإقفال")}" class="flex gap-2" style="flex-wrap:wrap">${steps.map(([n, st], i) => `<span class="chip" ${st === "on" ? 'aria-current="step" style="background:var(--brand-soft);border-color:var(--brand-border);color:var(--text)"' : ""}><span class="num" style="width:22px;height:22px;border-radius:999px;display:grid;place-items:center;font-size:12px;${st === "done" ? "background:var(--ok-soft);color:var(--ok)" : st === "on" ? "background:var(--brand);color:var(--brand-contrast)" : "border:1px solid var(--border-input)"}">${st === "done" ? icon("check", 12) : i + 1}</span>${n}</span>`).join("")}</nav>
      <div class="cols-side">
        <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px" aria-labelledby="cnt-h">
          <div><h2 id="cnt-h" class="sub" style="margin:0">${T("Count the cash in the drawer", "عدّ النقد في الصندوق")}</h2><p class="cap" style="margin:2px 0 0">${T("Register 1 · Shift #42 · Maya. Count both currencies; the expected amount stays hidden until you finish (blind count).", "الصندوق 1 · الوردية #42 · مايا. عدّ العملتين؛ يبقى المبلغ المتوقع مخفياً حتى تنتهي (عدّ أعمى).")}</p></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px">
            <div class="inset" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="font-semibold">${T("US dollars", "الدولار")}</div>${[["$100", "3"], ["$50", "2"], ["$20", "5"], ["$10", "5"], ["$5", "4"], ["$1", "12"]].map(([d, q]) => `<div class="flex items-center gap-3"><span class="num" style="width:56px">${d}</span><span style="color:var(--text-3)">×</span><span class="field-row field" style="width:96px;min-height:40px" dir="ltr"><input inputmode="numeric" value="${q}" aria-label="${T("Count of", "عدد")} ${d}" style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;font-weight:600;text-align:end;outline:none"></span><span class="num font-semibold" style="margin-inline-start:auto">${usd(Number(d.slice(1)) * Number(q))}</span></div>`).join("")}<div class="flex justify-between font-semibold" style="border-top:1px solid var(--border);padding-top:8px"><span>${T("Dollars", "الدولار")}</span><span class="num">$582.00</span></div></div>
            <div class="inset" style="padding:14px;display:flex;flex-direction:column;gap:8px"><div class="font-semibold">${T("Lebanese pounds", "الليرة اللبنانية")}</div>${[["100,000", "26"], ["50,000", "1"], ["20,000", "1"], ["10,000", "1"], ["5,000", "1"], ["1,000", "0"]].map(([d, q]) => `<div class="flex items-center gap-3"><span class="num" style="width:72px">${d}</span><span style="color:var(--text-3)">×</span><span class="field-row field" style="width:96px;min-height:40px" dir="ltr"><input inputmode="numeric" value="${q}" aria-label="${T("Count of", "عدد")} ${d}" style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;font-weight:600;text-align:end;outline:none"></span><span class="num font-semibold" style="margin-inline-start:auto">${(Number(d.replace(/,/g, "")) * Number(q)).toLocaleString("en-US")}</span></div>`).join("")}<div class="flex justify-between font-semibold" style="border-top:1px solid var(--border);padding-top:8px"><span>${T("Pounds", "الليرة")}</span><span class="num">${lbp(2685000)}</span></div></div>
          </div>
          <div class="cap">${T("Pounds are converted at today's rate (89,500): 2,685,000 LBP = $30.00. Total counted $612.00.", "تُحوَّل الليرة بسعر اليوم (89,500): 2,685,000 ل.ل = 30.00$. المجموع المعدود 612.00$.")}</div>
          <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn">${dirIcon("arrow-left", 16)}${T("Back", "رجوع")}</button><button class="btn btn-primary" style="margin-inline-start:auto">${T("Next: review", "التالي: المراجعة")}${dirIcon("arrow-right", 16)}</button></div>
        </section>
        <div class="stack">
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-labelledby="sh-h">
            <h2 id="sh-h" class="sub" style="margin:0">${T("Shifts today", "ورديات اليوم")}</h2>
            ${[[T("Register 1 · #42 · Maya", "الصندوق 1 · #42 · مايا"), statusBadge("info", "clock", T("Counting now", "قيد العدّ"))], [T("Register 2 · #7Q2K-019 · Ali", "الصندوق 2 · #7Q2K-019 · علي"), statusBadge("ok", "check", T("Closed 21:40", "أُغلقت 21:40"))]].map(([n, b]) => `<div class="flex items-center gap-3" style="padding:6px 0;border-top:1px solid var(--border)"><span style="flex:1">${n}</span>${b}</div>`).join("")}
          </section>
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
            <h2 class="sub" style="margin:0">${T("Before closing", "قبل الإقفال")}</h2>
            ${[[statusBadge("ok", "check", T("All sales sent", "أُرسلت كل المبيعات")), ""], [statusBadge("ok", "check", T("No money conflicts", "لا تعارضات مالية")), ""], [statusBadge("ok", "check", T("Expenses recorded: 3 · $41.00", "المصاريف المسجلة: 3 · 41.00$")), ""]].map(([b]) => `<div>${b}</div>`).join("")}
          </section>
        </div>
      </div>
      ${board([
        state("dialog", T("Review: drawer short by $6.50", "المراجعة: نقص في الصندوق 6.50$"), `
          ${kv([[T("Opening float", "الرصيد الافتتاحي"), "$100.00"], [T("Cash sales", "المبيعات النقدية"), "$612.00"], [T("Cash refunds", "المرتجعات النقدية"), "−$18.40"], [T("Cash expenses & supplier payments", "المصاريف ودفعات الموردين نقداً"), "−$75.10"], [T("Expected in drawer", "المتوقع في الصندوق"), "$618.50"], [T("Counted", "المعدود"), "$612.00"]])}
          <div class="banner t-warn" role="status"><span>${T("Short", "نقص")}</span><span class="num font-semibold" style="margin-inline-start:auto;font-size:20px">−$6.50</span></div>
          ${select(T("Reason (required when over or short)", "السبب (مطلوب عند الزيادة أو النقص)"), [T("Choose a reason…", "اختر سبباً…"), T("Change given incorrectly", "باقٍ خاطئ"), T("Uncounted expense", "مصروف غير مسجل"), T("Unknown", "غير معروف")])}
          ${errLine("why-err", T("Choose a reason to close with a difference.", "اختر سبباً للإقفال مع فرق."))}`,
          `<button class="btn">${T("Recount", "إعادة العدّ")}</button><button class="btn btn-primary">${T("Close the day", "إقفال اليوم")}</button>`),
        state("error", T("Blocked: rejected refunds", "متوقف: مرتجعات مرفوضة"), `<div class="banner t-err" role="alert">${icon("octagon-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("2 refunds were rejected by the server · $32.40", "رفض الخادم مرتجعين · 32.40$")}</div><div class="cap" style="color:var(--text-2)">${T("The cash already left the drawer. Settle them so the day's totals are right.", "خرج النقد من الصندوق بالفعل. سوِّهما لتكون أرقام اليوم صحيحة.")}</div></div></div>`, `<button class="btn btn-primary btn-sm">${T("Review & settle", "مراجعة وتسوية")}</button>`),
        state("warning", T("Another register is still open", "صندوق آخر لا يزال مفتوحاً"), `<div class="banner t-warn" role="status">${icon("clock", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Register 2 · shift #7Q2K-019 is open", "الصندوق 2 · الوردية #7Q2K-019 مفتوحة")}</div><div class="cap" style="color:var(--text-2)">${T("Close that shift on Register 2 first. The day closes once every shift is closed.", "أغلق تلك الوردية على الصندوق 2 أولاً. يُقفل اليوم عند إغلاق كل الورديات.")}</div></div></div>`),
        state("warning", T("Sales still waiting to send", "مبيعات بانتظار الإرسال"), `<div class="banner t-warn" role="status">${icon("cloud-upload", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("3 sales from this register haven't reached the server", "3 مبيعات من هذا الصندوق لم تصل إلى الخادم")}</div><div class="cap" style="color:var(--text-2)">${T("The close uses this register's numbers. The owner report updates when they arrive.", "يستخدم الإقفال أرقام هذا الصندوق. يتحدث تقرير المالك عند وصولها.")}</div></div></div>`, `<button class="btn btn-sm">${icon("refresh-cw", 14)}${T("Send now", "أرسل الآن")}</button>`),
        state("done", T("Day closed", "أُقفل اليوم"), `<div class="flex items-center gap-3">${icon("circle-check", 22, "var(--ok)")}<div><div class="font-semibold">${T("Friday 16 Oct is closed", "أُقفل يوم الجمعة 16 تشرين الأول")}</div><div class="cap num">${T("Net sales $1,842.30 · short $6.50 (change given incorrectly)", "صافي المبيعات 1,842.30$ · نقص 6.50$ (باقٍ خاطئ)")}</div></div></div>`, `<button class="btn btn-sm">${icon("printer", 14)}${T("Print Z report", "طباعة تقرير Z")}</button>`),
        state("permission", T("Cashiers close their own shift only", "الكاشير يغلق ورديته فقط"), denied(T("Closing the day is for managers", "إقفال اليوم للمدراء"), T("You can close your shift. Closing the whole day needs the Money permission.", "يمكنك إغلاق ورديتك. إقفال اليوم يتطلب صلاحية المال."), `<button class="btn btn-sm">${icon("users", 14)}${T("Switch user", "تبديل المستخدم")}</button>`)),
      ])}`,
    }),
  }

  // ── 20 Drivers ────────────────────────────────────────────────────────────
  const drivers = [[T("Ali Hamdan", "علي حمدان"), "03 220 118", "ok", T("At the store", "في المتجر"), "6", "$0.00"], [T("Samir Haddad", "سمير حداد"), "71 404 552", "info", T("On a delivery · D-1035", "في توصيل · D-1035"), "5", "$64.20"], [T("Jad Nasser", "جاد ناصر"), "76 118 903", "mute", T("Offline since 11:20", "غير متصل منذ 11:20"), "3", "$32.20"]]
  S["20-drivers"] = {
    title: T("Delivery · drivers", "التوصيل · السائقون"),
    body: shell({
      active: "delivery", crumb: T("Delivery", "التوصيل"), page: T("Drivers", "السائقون"),
      tabs: [["o", T("Orders", "الطلبات"), "7"], ["d", T("Drivers", "السائقون"), "3"], ["z", T("Zones & fees", "المناطق والرسوم")]], activeTab: "d",
      actions: `<button class="btn btn-sm">${icon("user-plus", 16)}${T("Add driver", "إضافة سائق")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="cols-2">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl cards-sm"><thead><tr><th>${T("Driver", "السائق")}</th><th>${T("Now", "الآن")}</th><th class="r">${T("Delivered today", "سُلّمت اليوم")}</th><th class="r">${T("Cash to hand over", "نقد للتسليم")}</th></tr></thead><tbody>
          ${drivers.map(([n, ph, tone, now, done, cash], i) => `<tr class="${i === 1 ? "sel" : ""}">${td(T("Driver", "السائق"), `<div class="font-semibold">${n}</div><div class="cap num" dir="ltr" style="text-align:start">${ph}</div>`)}${td(T("Now", "الآن"), `<span class="badge t-${tone}"><span class="dot" style="background:var(--${tone === "mute" ? "text-3" : tone})"></span>${now}</span>`)}${td(T("Delivered today", "سُلّمت اليوم"), `<span class="num">${done}</span>`, "r")}${td(T("Cash to hand over", "نقد للتسليم"), `<span class="num font-semibold">${cash}</span>`, "r")}</tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="dr-h">
          ${head(`<span id="dr-h">${T("Samir Haddad", "سمير حداد")}</span>`, `<span dir="ltr">71 404 552</span> · ${T("driver app 1.0.49 · paired", "تطبيق السائق 1.0.49 · مقترن")}`, closeBtn())}
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${[[T("Collected today", "حُصّل اليوم"), "$164.20"], [T("Handed over", "سُلّم"), "$100.00"]].map(([k, v]) => `<div class="inset" style="padding:10px"><div class="cap">${k}</div><div class="num" style="font-size:22px;font-weight:600;line-height:30px">${v}</div></div>`).join("")}</div>
            <h3 class="sub" style="margin:0;font-size:15px">${T("Today", "اليوم")}</h3>
            ${[["D-1035", T("Omar · Mar Elias", "عمر · مار الياس"), "$33.60", statusBadge("info", "bike", T("On the way", "في الطريق"))], ["D-1031", T("Lara · Hamra", "لارا · الحمرا"), "$30.60", statusBadge("ok", "check", T("Delivered 13:02", "سُلّم 13:02"))], ["D-1028", T("Fouad · Verdun", "فؤاد · فردان"), "$22.00", statusBadge("ok", "check", T("Delivered 12:20", "سُلّم 12:20"))]].map(([no, w, t, b]) => `<div class="flex items-center gap-3" style="padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap"><span class="num font-semibold">${no}</span><span style="flex:1;min-width:120px;color:var(--text-2)">${w}</span><span class="num">${t}</span>${b}</div>`).join("")}
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("phone", 14)}${T("Call", "اتصال")}</button><button class="btn btn-primary btn-sm" style="margin-inline-start:auto">${icon("hand-coins", 14)}${T("Record cash handover", "تسجيل تسليم النقد")}</button></div>
          </div>
        </section>
      </div>
      ${board([
        state("dialog", T("Cash handover · Samir", "تسليم النقد · سمير"), `
          ${kv([[T("Expected", "المتوقع"), `$64.20 · ${lbp(5745900)}`]])}
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${moneyIn(T("Received USD", "المستلم بالدولار"), "$", "44.20")}${moneyIn(T("Received LBP", "المستلم بالليرة"), T("LBP", "ل.ل"), "1,790,000", false)}</div>
          <div class="banner t-ok" role="status"><span>${T("Matches the expected amount", "يطابق المبلغ المتوقع")}</span><span class="num font-semibold" style="margin-inline-start:auto">$64.20</span></div>
          <div class="cap">${T("Goes into the drawer of the open shift (#42) as cash in.", "يدخل إلى صندوق الوردية المفتوحة (#42) كنقد وارد.")}</div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Record $64.20", "تسجيل 64.20$")}</button>`),
        state("dialog", T("Add a driver", "إضافة سائق"), `${input(T("Name", "الاسم"), T("Fadi Rizk", "فادي رزق"))}<label style="display:block"><span class="label">${T("Mobile", "الجوال")}</span><input class="field num" dir="ltr" inputmode="tel" value="70 912 334"></label><div class="cap">${T("Fadi gets a pairing code to open the driver app on his phone.", "يحصل فادي على رمز إقران لفتح تطبيق السائق على هاتفه.")}</div>`, `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Add and show code", "أضف واعرض الرمز")}</button>`),
        state("error", T("Driver app not paired", "تطبيق السائق غير مقترن"), `<div class="banner t-err" role="alert">${icon("smartphone", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Jad's phone is no longer paired", "لم يعد هاتف جاد مقترناً")}</div><div class="cap" style="color:var(--text-2)">${T("He can't receive orders. Pair the phone again with a new code.", "لا يمكنه استلام الطلبات. أقرن الهاتف مجدداً برمز جديد.")}</div></div></div>`, `<button class="btn btn-primary btn-sm">${icon("qr-code", 14)}${T("New pairing code", "رمز إقران جديد")}</button>`),
        state("empty", T("No drivers yet", "لا سائقين بعد"), empty("bike", T("Add your first driver", "أضف سائقك الأول"), T("Drivers get orders on their phone and you see where every order is.", "يستلم السائقون الطلبات على هواتفهم وترى مكان كل طلب."), `<button class="btn btn-primary btn-sm">${icon("user-plus", 14)}${T("Add driver", "إضافة سائق")}</button>`)),
        state("permission", T("Handover needs the Money permission", "التسليم يتطلب صلاحية المال"), `<div class="flex items-center gap-2" style="flex-wrap:wrap"><button class="btn btn-sm" disabled aria-describedby="ho-perm">${icon("lock", 14)}${T("Record cash handover", "تسجيل تسليم النقد")}</button><span id="ho-perm" class="cap">${T("Cash into the drawer needs the Money permission.", "إدخال النقد إلى الصندوق يتطلب صلاحية المال.")}</span></div>`),
      ])}`,
    }),
  }

  // ── 21 Backup & recovery ──────────────────────────────────────────────────
  S["21-backup-recovery"] = {
    title: T("Admin · backup & recovery", "الإدارة · النسخ والاستعادة"),
    body: shell({
      active: "admin", crumb: T("Admin", "الإدارة"), page: T("Backup & recovery", "النسخ والاستعادة"), tabs: ADMIN_TABS, activeTab: "b",
      actions: `<button class="btn btn-sm">${icon("hard-drive-download", 16)}${T("Back up now", "انسخ الآن")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="cols-2b">
        <div class="stack">
          <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:12px" aria-labelledby="bk-h">
            <div class="flex items-center gap-3" style="flex-wrap:wrap">${icon("shield-check", 28, "var(--ok)")}<div style="flex:1;min-width:0"><h2 id="bk-h" class="sub" style="margin:0">${T("Your data is backed up", "بياناتك منسوخة احتياطياً")}</h2><div class="cap">${T("Last copy today 21:00 · on this PC and in your Titan account", "آخر نسخة اليوم 21:00 · على هذا الجهاز وفي حساب Titan")}</div></div></div>
            <div class="scroll-x"><table class="tbl prio"><thead><tr><th>${T("Backup", "النسخة")}</th><th class="col-opt">${T("Where", "المكان")}</th><th class="r col-opt">${T("Size", "الحجم")}</th><th><span class="sr-only">${T("Action", "إجراء")}</span></th></tr></thead><tbody>
            ${[[T("Today 21:00 · automatic", "اليوم 21:00 · تلقائية"), T("This PC + account", "هذا الجهاز + الحساب"), "48 MB"], [T("Yesterday 21:00 · automatic", "أمس 21:00 · تلقائية"), T("This PC + account", "هذا الجهاز + الحساب"), "47 MB"], [T("14 Oct 09:12 · before update 1.0.49", "14 تشرين الأول 09:12 · قبل التحديث 1.0.49"), T("This PC", "هذا الجهاز"), "46 MB"]].map(([n, w, sz]) => `<tr><td class="font-semibold">${n}</td><td class="col-opt" style="color:var(--text-2)">${w}</td><td class="r num col-opt">${sz}</td><td class="r"><button class="btn btn-sm">${T("Restore", "استعادة")}</button></td></tr>`).join("")}
            </tbody></table></div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("folder-open", 14)}${T("Restore from a file", "استعادة من ملف")}</button><button class="btn btn-sm">${icon("download", 14)}${T("Export a copy", "تصدير نسخة")}</button></div>
          </section>
        </div>
        <div class="stack">
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-labelledby="sch-h">
            <h2 id="sch-h" class="sub" style="margin:0">${T("Schedule", "الجدولة")}</h2>
            ${kv([[T("Automatic backup", "النسخ التلقائي"), T("Every day at 21:00", "كل يوم الساعة 21:00")], [T("Kept on this PC", "يُحفظ على هذا الجهاز"), T("Last 14 copies", "آخر 14 نسخة")], [T("Store", "المتجر"), "fakih-hamra"]])}
          </section>
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
            <h2 class="sub" style="margin:0">${T("New or replaced PC?", "جهاز جديد أو بديل؟")}</h2>
            <div class="cap">${T("Sign in to this store on the new PC. Everything is downloaded from your account; no file is needed.", "سجّل الدخول إلى هذا المتجر على الجهاز الجديد. يُنزَّل كل شيء من حسابك دون حاجة لملف.")}</div>
          </section>
        </div>
      </div>
      ${board([
        state("dialog", T("Restore today 21:00?", "استعادة نسخة اليوم 21:00؟"), `
          <div class="cap">${T("This PC's data is replaced with the backup. Your Titan account is not changed.", "تُستبدل بيانات هذا الجهاز بالنسخة. لا يتغير حساب Titan.")}</div>
          <div class="banner t-warn" role="status">${icon("cloud-upload", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("3 changes haven't been sent yet", "3 تغييرات لم تُرسل بعد")}</div><div class="cap" style="color:var(--text-2)">${T("They are sent first. Restore starts when they are on the server.", "تُرسل أولاً. تبدأ الاستعادة عند وصولها إلى الخادم.")}</div></div></div>
          <label class="flex items-center gap-2" style="min-height:44px;cursor:pointer"><input type="checkbox" style="width:20px;height:20px;accent-color:var(--brand)"><span>${T("I understand this PC's data will be replaced", "أفهم أن بيانات هذا الجهاز ستُستبدل")}</span></label>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-danger">${T("Send changes, then restore", "أرسل التغييرات ثم استعد")}</button>`),
        state("progress", T("Restoring", "جارٍ الاستعادة"), `<div class="flex justify-between cap num"><span>${T("Sales 3,912 / 8,040", "المبيعات 3,912 / 8,040")}</span><span>${T("about 2 min left", "بقيت دقيقتان تقريباً")}</span></div><div style="height:6px;border-radius:999px;background:var(--surface-3)" role="progressbar" aria-valuenow="48" aria-valuemax="100" aria-label="${T("Restore progress", "تقدم الاستعادة")}"><div style="width:48%;height:6px;border-radius:999px;background:var(--info)"></div></div><div class="cap">${T("Keep this window open. Selling is paused until it finishes.", "أبقِ النافذة مفتوحة. يتوقف البيع حتى تنتهي.")}</div>`),
        state("error", T("Backup belongs to another store", "النسخة لمتجر آخر"), `<div class="banner t-err" role="alert">${icon("circle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("This file is from \"Bendo Market\", not Fakih Market", "هذا الملف من \"سوق بيندو\" وليس سوبرماركت فقيه")}</div><div class="cap" style="color:var(--text-2)">${T("Restoring it would mix two stores' data, so it is refused. Nothing was changed.", "استعادته ستخلط بيانات متجرين، لذا رُفضت. لم يتغير شيء.")}</div></div></div>`, `<button class="btn btn-sm">${T("Choose another file", "اختر ملفاً آخر")}</button>`),
        state("warning", T("Offline: account copy unavailable", "غير متصل: نسخة الحساب غير متاحة"), `<div class="cap">${T("Backups on this PC still work. The account copy is made when the internet is back.", "النسخ على هذا الجهاز تعمل. تُنشأ نسخة الحساب عند عودة الإنترنت.")}</div>`),
        state("done", T("Restored", "اكتملت الاستعادة"), `<div class="flex items-center gap-3">${icon("circle-check", 22, "var(--ok)")}<div><div class="font-semibold">${T("Restored today 21:00", "استُعيدت نسخة اليوم 21:00")}</div><div class="cap">${T("Changes made after 21:00 come back from your account at the next sync.", "التغييرات بعد 21:00 تعود من حسابك عند المزامنة التالية.")}</div></div></div>`),
        state("permission", T("Owners only", "للمالكين فقط"), denied(T("Restore is for owners", "الاستعادة للمالكين"), T("Restoring replaces data on this PC. Ask Rami.", "الاستعادة تستبدل البيانات على هذا الجهاز. اطلب من رامي."), "")),
      ])}`,
    }),
  }
  return S
}
