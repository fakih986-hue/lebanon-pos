// Midnight Gold v2: the remaining surfaces (10–17), built from the same tokens
// and helpers as build-prototypes.cjs. Each page shows its main state and,
// below it, a "States" board with the page's dialogs, errors, empty and
// permission states (static previews; behaviour is specified in
// DESIGN-SYSTEM.md and ROUTE-COVERAGE.md).
module.exports = function screensOps(h) {
  const { T, lbp, usd, icon, dirIcon, capsule, shell, seg, moneyIn, chips, logo } = h
  const S = {}

  const kv = (rows) => rows.map(([k, v, cls = ""]) => `<div class="flex justify-between gap-3" style="flex-wrap:wrap"><span style="color:var(--text-2)">${k}</span><span class="num font-semibold ${cls}">${v}</span></div>`).join("")
  const statusBadge = (tone, ic, text) => `<span class="badge t-${tone}">${icon(ic, 12)}${text}</span>`
  const head = (title, sub = "", extra = "") => `<div class="flex items-start gap-3" style="padding:16px 20px;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><h2 class="sub" style="margin:0">${title}</h2>${sub ? `<div class="cap num">${sub}</div>` : ""}</div>${extra}</div>`
  const closeBtn = () => `<button class="btn btn-ghost btn-sm" aria-label="${T("Close", "إغلاق")}">${icon("x", 16)}</button>`
  const KIND = { dialog: [T("Dialog", "نافذة"), "t-info", "app-window"], error: [T("Error", "خطأ"), "t-err", "circle-alert"], empty: [T("Empty", "فارغ"), "t-mute", "inbox"], permission: [T("Permission", "صلاحية"), "t-mute", "shield-off"], warning: [T("Warning", "تنبيه"), "t-warn", "triangle-alert"], progress: [T("In progress", "قيد التنفيذ"), "t-info", "loader"], done: [T("Done", "تم"), "t-ok", "circle-check"] }
  // A static preview of one state. Dialogs keep their dialog anatomy (title, body, footer actions).
  const state = (kind, title, body, footer = "") => {
    const [label, tone, ic] = KIND[kind]
    return `<section class="card" style="display:flex;flex-direction:column;${kind === "dialog" ? "box-shadow:var(--elev-3);" : ""}" aria-label="${label}: ${title}">
      <div class="flex items-center gap-2" style="padding:14px 18px;border-bottom:1px solid var(--border)"><span class="badge ${tone}">${icon(ic, 12)}${label}</span><h3 class="sub" style="margin:0;font-size:15px">${title}</h3></div>
      <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;flex:1">${body}</div>
      ${footer ? `<div class="flex gap-2" style="padding:12px 18px;border-top:1px solid var(--border);flex-wrap:wrap;justify-content:flex-end">${footer}</div>` : ""}
    </section>`
  }
  const board = (items) => `<section aria-labelledby="states-title" style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
      <div><h2 id="states-title" class="title" style="margin:0">${T("States on this page", "حالات هذه الصفحة")}</h2><p class="cap" style="margin:2px 0 0">${T("Dialogs, errors, empty and permission states, shown side by side for review.", "النوافذ والأخطاء والحالات الفارغة والصلاحيات، معروضة للمراجعة.")}</p></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:16px;align-items:start">${items.join("")}</div>
    </section>`
  const empty = (ic, title, text, action = "") => `<div class="inset" style="padding:24px;text-align:center;border-style:dashed;display:flex;flex-direction:column;align-items:center;gap:6px">${icon(ic, 22, "var(--text-2)")}<div class="font-semibold">${title}</div><div class="cap" style="max-width:300px">${text}</div>${action}</div>`
  const denied = (title, text, action) => `<div class="inset" style="padding:20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px"><span class="badge t-mute" style="min-height:40px;width:40px;justify-content:center;padding:0;border-radius:12px">${icon("shield-off", 20)}</span><div class="sub">${title}</div><div class="cap" style="max-width:300px">${text}</div>${action}</div>`
  const errLine = (id, text) => `<span id="${id}" class="error">${icon("circle-alert", 14)}${text}</span>`
  const input = (label, value, extra = "") => `<label style="display:block"><span class="label">${label}</span><input class="field" value="${value}" ${extra}></label>`
  const select = (label, options, sel = 0) => `<label style="display:block"><span class="label">${label}</span><select class="field">${options.map((o, i) => `<option${i === sel ? " selected" : ""}>${o}</option>`).join("")}</select></label>`
  const search = (ph) => `<label class="field-row field" style="width:min(340px,100%)">${icon("search", 16, "var(--text-3)")}<span class="sr-only">${T("Search", "بحث")}</span><input style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;outline:none" placeholder="${ph}"></label>`
  const synced = capsule("ok", T("Synced 1 min ago", "تمت المزامنة منذ دقيقة"))
  const SELL_TABS = [["reg", T("Register", "الصندوق")], ["rec", T("Receipts", "الإيصالات"), "128"], ["held", T("Held sales", "المبيعات المعلقة"), "2"]]
  const STOCK_TABS = [["p", T("Products", "المنتجات")], ["l", T("Lots & counts", "الدفعات والجرد")], ["r", T("Receiving", "الاستلام")], ["s", T("Suppliers", "الموردون")]]
  const MONEY_TABS = [["t", T("Today", "اليوم")], ["s", T("Shift & drawer", "الوردية والصندوق")], ["e", T("Expenses", "المصاريف")], ["c", T("Customers & debt", "الزبائن والديون")], ["r", T("Reports", "التقارير")]]
  const ADMIN_TABS = [["t", T("Team & permissions", "الفريق والصلاحيات")], ["s", T("Store settings", "إعدادات المتجر")], ["d", T("Devices & sync", "الأجهزة والمزامنة")], ["b", T("Backup & recovery", "النسخ والاستعادة")], ["a", T("About & updates", "حول والتحديثات")]]

  // ── 10 Receipts ───────────────────────────────────────────────────────────
  const receipts = [
    ["S-482911", "14:32", T("Maya", "مايا"), T("Cash", "نقداً"), 21.81, "partial"],
    ["S-482910", "14:27", T("Maya", "مايا"), T("Card", "بطاقة"), 9.5, "ok"],
    ["S-482907", "14:05", T("Ali", "علي"), T("Debt · Rami's Bakery", "دين · مخبز رامي"), 64.2, "debt"],
    ["S-482903", "13:48", T("Maya", "مايا"), T("Cash", "نقداً"), 3.6, "void"],
    ["S-7Q2K-0091", "13:40", T("Register 2", "الصندوق 2"), T("Cash", "نقداً"), 12.75, "pending"],
    ["S-482899", "13:22", T("Ali", "علي"), T("Wallet", "محفظة"), 18.4, "ok"],
  ]
  const rStatus = {
    ok: statusBadge("ok", "check", T("Completed", "مكتمل")),
    partial: statusBadge("info", "undo-2", T("Partly refunded", "مرتجع جزئياً")),
    debt: statusBadge("warn", "hand-coins", T("On debt", "دين")),
    void: statusBadge("mute", "ban", T("Voided", "ملغى")),
    pending: statusBadge("warn", "cloud-upload", T("Waiting to send", "بانتظار الإرسال")),
  }
  S["10-receipts"] = {
    title: T("Sell · receipts", "البيع · الإيصالات"),
    body: shell({
      active: "sell", crumb: T("Sell", "البيع"), page: T("Receipts", "الإيصالات"), tabs: SELL_TABS, activeTab: "rec",
      capsuleHtml: capsule("err", T("1 refund needs review", "مرتجع بحاجة لمراجعة"), "octagon-alert"),
      content: `
      <div class="flex items-center gap-2" style="flex-wrap:wrap">${search(T("Receipt no., customer or item…", "رقم الإيصال أو الزبون أو الصنف…"))}<div class="flex gap-2" style="flex-wrap:wrap" role="group" aria-label="${T("Filter", "تصفية")}">${chips([[T("Today", "اليوم"), "128"], [T("Refunded", "مرتجعة"), "6"], [T("Voided", "ملغاة"), "2"], [T("Waiting to send", "بانتظار الإرسال"), "1", "warn"]])}</div></div>
      <div class="cols-2">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl cards-sm" style="min-width:640px"><thead><tr><th>${T("Receipt", "الإيصال")}</th><th>${T("Status", "الحالة")}</th><th>${T("Cashier · payment", "الكاشير · الدفع")}</th><th class="r">${T("Total", "المجموع")}</th></tr></thead><tbody>
          ${receipts.map(([no, t, who, pay, total, st], i) => `<tr class="${i === 0 ? "sel" : ""}"><td data-label="${T("Receipt", "الإيصال")}"><div class="font-semibold num" style="white-space:nowrap">${no}</div><div class="cap num">${T("Today", "اليوم")} ${t}</div></td><td data-label="${T("Status", "الحالة")}" class="r-sm">${rStatus[st]}</td><td data-label="${T("Cashier", "الكاشير")}" style="color:var(--text-2)">${who} · ${pay}</td><td data-label="${T("Total", "المجموع")}" class="r"><div class="num font-semibold">${usd(total)}</div><div class="cap num" style="white-space:nowrap">${lbp(pay === T("Cash", "نقداً") ? Math.ceil(total * 89500 / 5000) * 5000 : Math.round(total * 89500 / 1000) * 1000)}</div></td></tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="rc-title">
          ${head(`<span id="rc-title" class="num">S-482911</span>`, T("Today 14:32 · Maya · Register 1 · Shift #42", "اليوم 14:32 · مايا · الصندوق 1 · الوردية #42"), closeBtn())}
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
            <div class="flex gap-2" style="flex-wrap:wrap">${rStatus.partial}<span class="badge t-mute num">${T("Rate 89,500 LBP / $1", "السعر 89,500 ل.ل / 1$")}</span></div>
            ${[[T("Almarai Laban 1 L", "لبن المراعي 1 ل"), "2 × $1.85", "$3.70", T("1 refunded", "أُرجع 1")], [T("Ariel Pods 22", "آرييل كبسولات 22"), "1 × $9.50", "$9.50", ""], [T("Arabic bread", "خبز عربي"), "3 × $0.95", "$2.85", ""], [T("Pepsi 330 ml", "بيبسي 330 مل"), "6 × $0.60", "$3.60", ""]].map(([n, q, t, r]) => `<div class="flex items-center gap-3" style="padding:6px 0;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><div class="font-semibold">${n}</div><div class="num" style="color:var(--text-2)">${q}${r ? ` · <span style="color:var(--info)">${r}</span>` : ""}</div></div><span class="num font-semibold">${t}</span></div>`).join("")}
            ${kv([[T("Total paid", "المدفوع"), `$21.81 · ${lbp(1955000)}`], [T("Refunded", "المرتجع"), `−$1.85 · R-7Q2K-LZ4M1B`], [T("Kept", "الصافي"), "$19.96"]])}
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("printer", 14)}${T("Reprint", "إعادة طباعة")}</button><button class="btn btn-sm">${icon("message-circle", 14)}WhatsApp</button><button class="btn btn-sm" disabled aria-describedby="void-why">${icon("ban", 14)}${T("Void", "إلغاء")}</button><button class="btn btn-primary btn-sm" style="margin-inline-start:auto">${dirIcon("undo-2", 14)}${T("Refund items", "إرجاع أصناف")}</button></div>
            <span id="void-why" class="cap">${T("Void is off because this receipt has a refund. Refund the remaining items instead.", "الإلغاء متوقف لأن لهذا الإيصال مرتجعاً. أرجِع الأصناف المتبقية بدلاً منه.")}</span>
          </div>
        </section>
      </div>
      ${board([
        state("dialog", T("Refund items · S-482911", "إرجاع أصناف · S-482911"), `
          <div class="cap">${T("Choose how many of each line come back. Limits include earlier refunds.", "اختر كمية كل سطر. الحدود تشمل المرتجعات السابقة.")}</div>
          ${[[T("Almarai Laban 1 L", "لبن المراعي 1 ل"), T("1 of 1 left", "بقي 1 من 1"), 1, ""], [T("Ariel Pods 22", "آرييل كبسولات 22"), T("1 of 1 left", "بقي 1 من 1"), 0, ""], [T("Pepsi 330 ml", "بيبسي 330 مل"), T("6 of 6 left", "بقي 6 من 6"), 7, T("Only 6 left to refund on this line", "بقي 6 فقط للإرجاع في هذا السطر")]].map(([n, left, q, err], i) => `<div class="flex items-center gap-3" style="flex-wrap:wrap"><div style="flex:1;min-width:140px"><div class="font-semibold">${n}</div><div class="cap">${left}</div>${err ? errLine(`rq-${i}`, err) : ""}</div><span class="field-row field" style="width:120px;min-height:44px${err ? ";border-color:var(--err)" : ""}" dir="ltr"><input inputmode="numeric" value="${q}" aria-label="${T("Quantity to refund", "كمية الإرجاع")} ${n}" ${err ? `aria-invalid="true" aria-describedby="rq-${i}"` : ""} style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;font-weight:600;text-align:end;outline:none"></span></div>`).join("")}
          ${seg("rf-method", T("Refund method", "طريقة الإرجاع"), [[T("Cash", "نقداً"), "banknote"], [T("Card", "بطاقة"), "credit-card"]], 0, 2)}
          ${select(T("Reason", "السبب"), [T("Damaged item", "صنف تالف"), T("Customer changed mind", "غيّر الزبون رأيه"), T("Wrong item", "صنف خاطئ")])}
          <div class="inset" style="padding:12px">${kv([[T("Refund", "المرتجع"), "$1.85"], [T("In LBP at the sale's rate", "بالليرة بسعر البيع"), lbp(165575)], [T("Pay out in cash", "يُدفع نقداً"), lbp(170000)]])}<div class="cap" style="margin-top:6px">${T("Uses the original rate (89,500), not today's.", "يستخدم السعر الأصلي (89,500) لا سعر اليوم.")}</div></div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Refund $1.85", "إرجاع 1.85$")}</button>`),
        state("error", T("Refund rejected by the server", "رفض الخادم المرتجع"), `
          <div class="banner t-err" role="alert">${icon("octagon-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">R-30412 · $18.40</div><div class="cap" style="color:var(--text-2)">${T("Issued offline. Register 1 had already refunded the same items, so the server refused it. The cash already left the drawer.", "صدر دون اتصال. أرجع الصندوق 1 الأصناف نفسها، فرفضه الخادم. خرج النقد من الصندوق بالفعل.")}</div></div></div>
          <div class="cap">${T("It stays on this receipt and in Money until a manager settles it.", "يبقى على هذا الإيصال وفي المال حتى يسوّيه مدير.")}</div>`,
          `<button class="btn btn-primary btn-sm">${T("Settle refund", "تسوية المرتجع")}</button>`),
        state("empty", T("No receipts match", "لا إيصالات مطابقة"), empty("search-x", T("No receipts match \"Tide\" today", "لا إيصالات تطابق \"تايد\" اليوم"), T("Try another word, or look at all dates.", "جرّب كلمة أخرى أو اعرض كل التواريخ."), `<button class="btn btn-sm">${T("Clear filters", "مسح التصفية")}</button>`)),
        state("permission", T("Cashier without the Refunds permission", "كاشير بلا صلاحية الإرجاع"), `
          <div class="flex items-center gap-2" style="flex-wrap:wrap"><button class="btn btn-sm" disabled aria-describedby="rf-perm">${icon("lock", 14)}${T("Refund items", "إرجاع أصناف")}</button><span id="rf-perm" class="cap">${T("Needs the Refunds permission.", "يتطلب صلاحية الإرجاع.")}</span></div>
          <button class="btn btn-sm" style="align-self:flex-start">${icon("key-round", 14)}${T("Manager approves with PIN", "موافقة المدير برمز PIN")}</button>`),
      ])}`,
    }),
  }

  // ── 11 Customers & debt ───────────────────────────────────────────────────
  const customers = [
    [T("Rami's Bakery", "مخبز رامي"), "03 412 908", 412.0, 500, T("3 days ago", "قبل 3 أيام"), ""],
    [T("Nour Haddad", "نور حداد"), "71 225 640", 186.5, 200, T("12 days ago", "قبل 12 يوماً"), "warn"],
    [T("Hussein Khalil", "حسين خليل"), "76 903 117", 640.0, 600, T("64 days ago", "قبل 64 يوماً"), "err"],
    [T("Layal Saab", "ليال صعب"), "70 881 402", 0, 300, T("today", "اليوم"), ""],
  ]
  S["11-customers-debt"] = {
    title: T("Money · customers & debt", "المال · الزبائن والديون"),
    body: shell({
      active: "money", crumb: T("Money", "المال"), page: T("Customers & debt", "الزبائن والديون"), tabs: MONEY_TABS, activeTab: "c",
      actions: `<button class="btn btn-sm">${icon("user-plus", 16)}${T("Add customer", "إضافة زبون")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="kpis">${[[T("Owed to you", "المستحق لك"), "$2,310.00", T("14 customers", "14 زبوناً")], [T("Overdue (60+ days)", "متأخر (60+ يوماً)"), "$940.00", T("3 customers", "3 زبائن")], [T("Collected this week", "المحصّل هذا الأسبوع"), "$615.00", T("21 payments", "21 دفعة")]].map(([l, v, f]) => `<div class="card" style="padding:16px"><span class="cap">${l}</span><div class="stat num" style="margin-top:6px">${v}</div><div class="cap meta num">${f}</div></div>`).join("")}</div>
      <div class="flex items-center gap-2" style="flex-wrap:wrap">${search(T("Name or phone…", "الاسم أو الهاتف…"))}<div class="flex gap-2" style="flex-wrap:wrap" role="group" aria-label="${T("Filter", "تصفية")}">${chips([[T("Owes money", "عليه دين"), "14"], [T("Overdue", "متأخر"), "3", "err"], [T("Over limit", "فوق الحد"), "1", "warn"], [T("All", "الكل"), "212"]])}</div></div>
      <div class="cols-2">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl cards-sm" style="min-width:600px"><thead><tr><th>${T("Customer", "الزبون")}</th><th class="r">${T("Balance", "الرصيد")}</th><th class="r">${T("Limit", "الحد")}</th><th>${T("Last payment", "آخر دفعة")}</th></tr></thead><tbody>
          ${customers.map(([n, ph, bal, lim, last, tone], i) => `<tr class="${i === 0 ? "sel" : ""}"><td data-label="${T("Customer", "الزبون")}"><div class="font-semibold">${n}</div><div class="cap num" dir="ltr" style="text-align:start">${ph}</div></td><td data-label="${T("Balance", "الرصيد")}" class="r"><span class="num font-semibold">${usd(bal)}</span>${bal > lim ? `<div><span class="badge t-warn">${icon("triangle-alert", 12)}${T("Over limit", "فوق الحد")}</span></div>` : ""}</td><td data-label="${T("Limit", "الحد")}" class="r num" style="color:var(--text-2)">${usd(lim)}</td><td data-label="${T("Last payment", "آخر دفعة")}">${tone === "err" ? statusBadge("err", "clock-alert", last) : tone === "warn" ? statusBadge("warn", "clock", last) : `<span class="cap">${last}</span>`}</td></tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="cu-title">
          ${head(`<span id="cu-title">${T("Rami's Bakery", "مخبز رامي")}</span>`, `<span dir="ltr">03 412 908</span> · ${T("customer since 2024", "زبون منذ 2024")}`, closeBtn())}
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${[[T("Balance", "الرصيد"), "$412.00"], [T("Credit limit", "حد الدين"), "$500.00"]].map(([k, v]) => `<div class="inset" style="padding:10px"><div class="cap">${k}</div><div class="num" style="font-size:22px;font-weight:600;line-height:30px">${v}</div></div>`).join("")}</div>
            <h3 class="sub" style="margin:0;font-size:15px">${T("Statement", "كشف الحساب")}</h3>
            <div class="scroll-x"><table class="tbl" style="min-width:380px"><thead><tr><th>${T("Date", "التاريخ")}</th><th>${T("What", "البيان")}</th><th class="r">${T("Amount", "المبلغ")}</th><th class="r">${T("Balance", "الرصيد")}</th></tr></thead><tbody>
            ${[["15 Oct", T("Sale S-482907", "بيع S-482907"), "+$64.20", "$412.00"], ["13 Oct", T("Payment · cash", "دفعة · نقداً"), "−$150.00", "$347.80"], ["11 Oct", T("Refund credit R-30388", "رصيد مرتجع R-30388"), "−$12.00", "$497.80"], ["09 Oct", T("Sale S-481540", "بيع S-481540"), "+$88.30", "$509.80"]].map(([d, w, a, b]) => `<tr><td class="num cap">${d}</td><td>${w}</td><td class="r num" style="color:${a.startsWith("−") ? "var(--ok)" : "var(--text)"}">${a}</td><td class="r num font-semibold">${b}</td></tr>`).join("")}
            </tbody></table></div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("message-circle", 14)}${T("Send statement", "إرسال الكشف")}</button><button class="btn btn-primary btn-sm" style="margin-inline-start:auto">${icon("hand-coins", 14)}${T("Record payment", "تسجيل دفعة")}</button></div>
          </div>
        </section>
      </div>
      ${board([
        state("dialog", T("Record payment · Rami's Bakery", "تسجيل دفعة · مخبز رامي"), `
          ${kv([[T("Owes now", "المستحق الآن"), "$412.00"]])}
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${moneyIn(T("Paid USD", "المدفوع بالدولار"), "$", "450.00")}${moneyIn(T("Paid LBP", "المدفوع بالليرة"), T("LBP", "ل.ل"), "0", false)}</div>
          ${errLine("pay-over", T("That is $38.00 more than the balance.", "هذا أكثر من الرصيد بـ 38.00$."))}
          ${seg("cu-method", T("Payment method", "طريقة الدفع"), [[T("Cash", "نقداً"), "banknote"], [T("Card", "بطاقة"), "credit-card"], [T("Transfer", "تحويل"), "landmark"]], 0, 3)}
          <div class="cap">${T("Cash goes into the drawer of the open shift (#42).", "يدخل النقد إلى صندوق الوردية المفتوحة (#42).")}</div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn">${T("Record $412.00 instead", "سجّل 412.00$ بدلاً منه")}</button><button class="btn btn-primary">${T("Record $450.00", "سجّل 450.00$")}</button>`),
        state("warning", T("At checkout: over the credit limit", "عند الدفع: فوق حد الدين"), `
          <div class="banner t-warn" role="alert">${icon("triangle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Hussein Khalil is $40.00 over his limit", "حسين خليل فوق حده بـ 40.00$")}</div><div class="cap" style="color:var(--text-2)">${T("Balance $640.00, limit $600.00. This sale adds $21.81.", "الرصيد 640.00$ والحد 600.00$. يضيف هذا البيع 21.81$.")}</div></div></div>`,
          `<button class="btn btn-sm">${T("Choose another payment", "اختر دفعاً آخر")}</button><button class="btn btn-sm">${icon("key-round", 14)}${T("Manager allows once", "يسمح المدير مرة")}</button>`),
        state("empty", T("No one owes money", "لا ديون مستحقة"), empty("smile", T("Nobody owes money right now", "لا أحد عليه دين الآن"), T("Debt sales and payments appear here.", "تظهر هنا مبيعات الدين والدفعات."), `<button class="btn btn-sm">${T("Show all customers", "اعرض كل الزبائن")}</button>`)),
        state("permission", T("No Debt permission", "بلا صلاحية الديون"), denied(T("Balances are view-only for you", "الأرصدة للعرض فقط لك"), T("Recording payments needs the Debt permission.", "تسجيل الدفعات يتطلب صلاحية الديون."), `<button class="btn btn-sm">${icon("users", 14)}${T("Switch user", "تبديل المستخدم")}</button>`)),
      ])}`,
    }),
  }

  // ── 12 Suppliers ──────────────────────────────────────────────────────────
  S["12-suppliers"] = {
    title: T("Stock · suppliers", "المخزون · الموردون"),
    body: shell({
      active: "stock", crumb: T("Stock", "المخزون"), page: T("Suppliers", "الموردون"), tabs: STOCK_TABS, activeTab: "s",
      actions: `<button class="btn btn-sm">${icon("plus", 16)}${T("Add supplier", "إضافة مورد")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="flex items-center gap-2" style="flex-wrap:wrap">${search(T("Supplier name or phone…", "اسم المورد أو الهاتف…"))}<div class="flex gap-2" style="flex-wrap:wrap" role="group" aria-label="${T("Filter", "تصفية")}">${chips([[T("You owe", "عليك"), "6"], [T("Open orders", "أوامر مفتوحة"), "4"], [T("All", "الكل"), "31"], [T("Archived", "مؤرشف"), "3"]])}</div></div>
      <div class="cols-2">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl prio" style="min-width:600px"><thead><tr><th>${T("Supplier", "المورد")}</th><th class="r">${T("You owe", "عليك")}</th><th class="col-opt">${T("Last delivery", "آخر شحنة")}</th><th class="r">${T("Open orders", "أوامر مفتوحة")}</th></tr></thead><tbody>
          ${[[T("Malia Group", "مجموعة ماليا"), "$1,284.50", T("today", "اليوم"), "1"], [T("Gandour", "غندور"), "$412.00", T("6 days ago", "قبل 6 أيام"), "2"], [T("Dairy Khoury", "ألبان خوري"), "$0.00", T("yesterday", "أمس"), "0"], [T("Sohat Water", "مياه صحة"), "$96.00", T("2 weeks ago", "قبل أسبوعين"), "1"]].map((r, i) => `<tr class="${i === 0 ? "sel" : ""}"><td class="font-semibold">${r[0]}</td><td class="r num font-semibold">${r[1]}</td><td class="cap col-opt">${r[2]}</td><td class="r num">${r[3]}</td></tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="su-title">
          ${head(`<span id="su-title">${T("Malia Group", "مجموعة ماليا")}</span>`, `<span dir="ltr">01 480 220</span> · ${T("pays on account, 30 days", "على الحساب، 30 يوماً")}`, closeBtn())}
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${[[T("You owe", "عليك"), "$1,284.50"], [T("Due within 7 days", "مستحق خلال 7 أيام"), "$420.00"]].map(([k, v]) => `<div class="inset" style="padding:10px"><div class="cap">${k}</div><div class="num" style="font-size:22px;font-weight:600;line-height:30px">${v}</div></div>`).join("")}</div>
            <h3 class="sub" style="margin:0;font-size:15px">${T("Statement", "كشف الحساب")}</h3>
            ${[[T("Delivery · supplier invoice INV-77431", "شحنة · فاتورة المورد INV-77431"), T("today", "اليوم"), "+$87.56"], [T("Payment · cash · shift #41", "دفعة · نقداً · الوردية #41"), T("3 Oct", "3 تشرين الأول"), "−$300.00"], [T("Purchase order PO-118 · partly received", "أمر الشراء PO-118 · استُلم جزئياً"), T("1 Oct", "1 تشرين الأول"), "+$40.80"]].map(([w, d, a]) => `<div class="flex items-center gap-3" style="padding:6px 0;border-bottom:1px solid var(--border)"><div style="flex:1;min-width:0"><div>${w}</div><div class="cap">${d}</div></div><span class="num font-semibold" style="color:${a.startsWith("−") ? "var(--ok)" : "var(--text)"}">${a}</span></div>`).join("")}
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("file-plus", 14)}${T("New purchase order", "أمر شراء جديد")}</button><button class="btn btn-primary btn-sm" style="margin-inline-start:auto">${icon("banknote", 14)}${T("Pay supplier", "الدفع للمورد")}</button></div>
          </div>
        </section>
      </div>
      ${board([
        state("dialog", T("Pay Malia Group", "الدفع لمجموعة ماليا"), `
          ${kv([[T("You owe", "عليك"), "$1,284.50"]])}
          ${moneyIn(T("Amount", "المبلغ"), "$", "300.00")}
          ${seg("su-method", T("Paid from", "الدفع من"), [[T("Drawer cash", "نقد الصندوق"), "banknote"], [T("Transfer", "تحويل"), "landmark"]], 0, 2)}
          <div class="banner t-info" style="font-size:13px">${icon("info", 16)}<span>${T("Drawer cash lowers the expected cash of shift #42 by $300.00.", "نقد الصندوق يخفض النقد المتوقع للوردية #42 بـ 300.00$.")}</span></div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Pay $300.00", "ادفع 300.00$")}</button>`),
        state("error", T("No open shift for a cash payment", "لا وردية مفتوحة للدفع النقدي"), `
          <div class="banner t-err" role="alert">${icon("circle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Open a shift to pay from the drawer", "افتح وردية للدفع من الصندوق")}</div><div class="cap" style="color:var(--text-2)">${T("Cash payments must belong to a shift so the drawer count stays right. Transfers don't need one.", "يجب أن ينتمي الدفع النقدي إلى وردية ليبقى عدّ الصندوق صحيحاً. التحويل لا يحتاج ذلك.")}</div></div></div>`,
          `<button class="btn btn-sm">${T("Pay by transfer", "ادفع بالتحويل")}</button><button class="btn btn-primary btn-sm">${T("Open shift", "فتح وردية")}</button>`),
        state("empty", T("No suppliers yet", "لا موردين بعد"), empty("building-2", T("Add your first supplier", "أضف موردك الأول"), T("Suppliers let you track deliveries, what you owe and purchase orders.", "يتيح لك الموردون تتبّع الشحنات والمستحقات وأوامر الشراء."), `<button class="btn btn-primary btn-sm">${icon("plus", 14)}${T("Add supplier", "إضافة مورد")}</button>`)),
        state("warning", T("Archived supplier", "مورد مؤرشف"), `
          <div class="flex items-center gap-2" style="flex-wrap:wrap">${statusBadge("mute", "archive", T("Archived", "مؤرشف"))}<span class="font-semibold">${T("Bekaa Farms", "مزارع البقاع")}</span></div>
          <div class="cap">${T("Still owed $58.00. Archived suppliers keep their history and balance; they can't receive new deliveries.", "لا يزال مستحقاً 58.00$. يحتفظ المورد المؤرشف بسجله ورصيده، ولا يستقبل شحنات جديدة.")}</div>`,
          `<button class="btn btn-sm">${T("Restore", "استعادة")}</button>`),
      ])}`,
    }),
  }

  // ── 13 Delivery ───────────────────────────────────────────────────────────
  const orderCard = (no, who, area, total, age, extra = "", tone = "") => `<button class="inset" style="width:100%;padding:12px;text-align:start;font:inherit;color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:6px${tone ? `;box-shadow:inset 3px 0 0 var(--${tone})` : ""}"><span class="flex items-center gap-2"><span class="font-semibold num">${no}</span><span class="cap num" style="margin-inline-start:auto">${age}</span></span><span>${who} · <span style="color:var(--text-2)">${area}</span></span><span class="flex items-center gap-2" style="flex-wrap:wrap"><span class="num font-semibold">${total}</span>${extra}</span></button>`
  S["13-delivery"] = {
    title: T("Delivery · orders", "التوصيل · الطلبات"),
    body: shell({
      active: "delivery", crumb: T("Delivery", "التوصيل"), page: T("Orders", "الطلبات"),
      tabs: [["o", T("Orders", "الطلبات"), "7"], ["d", T("Drivers", "السائقون"), "3"], ["z", T("Zones & fees", "المناطق والرسوم")]], activeTab: "o",
      actions: `<button class="btn btn-sm">${icon("pause", 16)}${T("Pause online orders", "إيقاف الطلبات مؤقتاً")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="flex items-center gap-2" style="flex-wrap:wrap">${search(T("Order no., customer or phone…", "رقم الطلب أو الزبون أو الهاتف…"))}<span class="pill t-ok" style="min-height:32px">${icon("radio", 14)}${T("Online ordering is on", "الطلب عبر الإنترنت مفعّل")}</span></div>
      <div class="scroll-x"><div style="display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:12px;min-width:1000px">
        ${[
          [T("New", "جديد"), "3", [orderCard("D-1042", T("Nour", "نور"), T("Hamra", "الحمرا"), "$18.40", T("2 min", "دقيقتان"), statusBadge("warn", "user-x", T("No driver", "بلا سائق")), "warn"), orderCard("D-1041", T("Karim", "كريم"), T("Verdun", "فردان"), "$42.10", T("6 min", "6 د"), statusBadge("warn", "user-x", T("No driver", "بلا سائق")), "warn"), orderCard("D-1040", T("Sara", "سارة"), T("Achrafieh", "الأشرفية"), "$9.75", T("9 min", "9 د"), statusBadge("mute", "banknote", T("Cash on delivery", "دفع عند الاستلام")))]],
          [T("Preparing", "قيد التحضير"), "2", [orderCard("D-1038", T("Hadi", "هادي"), T("Hamra", "الحمرا"), "$27.30", T("14 min", "14 د"), statusBadge("info", "user", T("Ali", "علي"))), orderCard("D-1037", T("Mira", "ميرا"), T("Ras Beirut", "رأس بيروت"), "$15.00", T("18 min", "18 د"), statusBadge("info", "user", T("Ali", "علي")))]],
          [T("Out for delivery", "في الطريق"), "2", [orderCard("D-1035", T("Omar", "عمر"), T("Mar Elias", "مار الياس"), "$33.60", T("26 min", "26 د"), statusBadge("info", "bike", T("Samir · 4 min away", "سمير · على بعد 4 د"))), orderCard("D-1033", T("Rana", "رنا"), T("Clemenceau", "كليمنصو"), "$12.20", T("41 min", "41 د"), statusBadge("err", "clock-alert", T("Late · 41 min", "متأخر · 41 د")), "err")]],
          [T("Delivered today", "سُلّمت اليوم"), "14", [`<div class="cap" style="padding:4px 2px">${T("14 orders · $412.80 · cash to collect from drivers: $96.40", "14 طلباً · 412.80$ · نقد يُستلم من السائقين: 96.40$")}</div>`, orderCard("D-1030", T("Fadi", "فادي"), T("Hamra", "الحمرا"), "$21.00", "13:10", statusBadge("ok", "check", T("Paid", "مدفوع")))]],
        ].map(([title, count, cards]) => `<section class="card" style="padding:12px;display:flex;flex-direction:column;gap:8px" aria-label="${title}"><div class="flex items-center gap-2" style="padding:2px 2px 6px"><h2 class="sub" style="margin:0;font-size:15px">${title}</h2><span class="badge t-mute num">${count}</span></div>${cards.join("")}</section>`).join("")}
      </div></div>
      ${board([
        state("dialog", T("Assign a driver · D-1042", "تعيين سائق · D-1042"), `
          ${kv([[T("Deliver to", "التوصيل إلى"), T("Nour · Hamra, Bliss St.", "نور · الحمرا، شارع بلس")], [T("Collect", "التحصيل"), `$18.40 · ${lbp(1650000)}`]])}
          <div role="radiogroup" aria-label="${T("Driver", "السائق")}" style="display:flex;flex-direction:column;gap:6px">${[[T("Ali", "علي"), T("At the store · 2 orders", "في المتجر · طلبان"), "ok", true], [T("Samir", "سمير"), T("On a delivery · back in ~10 min", "في توصيل · يعود بعد ~10 د"), "warn", false], [T("Jad", "جاد"), T("Offline since 11:20", "غير متصل منذ 11:20"), "mute", false]].map(([n, st, tone, on]) => `<label class="inset flex items-center gap-3" style="padding:10px 12px;cursor:pointer${on ? ";border-color:var(--brand-border);background:var(--brand-soft)" : ""}"><input type="radio" name="drv"${on ? " checked" : ""} style="width:18px;height:18px;accent-color:var(--brand)"><span style="flex:1"><span class="font-semibold" style="display:block">${n}</span><span class="cap">${st}</span></span><span class="dot" style="background:var(--${tone === "mute" ? "text-3" : tone})"></span></label>`).join("")}</div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Assign Ali", "عيّن علي")}</button>`),
        state("error", T("Driver is offline", "السائق غير متصل"), `
          <div class="banner t-warn" role="alert">${icon("wifi-off", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Jad's phone has been offline since 11:20", "هاتف جاد غير متصل منذ 11:20")}</div><div class="cap" style="color:var(--text-2)">${T("He won't see this order until his phone reconnects.", "لن يرى هذا الطلب حتى يعود هاتفه للاتصال.")}</div></div></div>`,
          `<button class="btn btn-sm">${T("Choose another driver", "اختر سائقاً آخر")}</button><button class="btn btn-sm">${T("Assign and call Jad", "عيّن واتصل بجاد")}</button>`),
        state("warning", T("Online orders paused", "الطلبات متوقفة مؤقتاً"), `
          <div class="banner t-warn" role="status">${icon("pause", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Customers can't order online", "لا يمكن للزبائن الطلب عبر الإنترنت")}</div><div class="cap" style="color:var(--text-2)">${T("Paused by Rami at 12:40. Orders already placed continue.", "أوقفها رامي الساعة 12:40. تستمر الطلبات الحالية.")}</div></div></div>`,
          `<button class="btn btn-primary btn-sm">${T("Resume online orders", "استئناف الطلبات")}</button>`),
        state("empty", T("No orders yet today", "لا طلبات اليوم بعد"), empty("truck", T("No delivery orders yet today", "لا طلبات توصيل اليوم بعد"), T("Online and phone orders appear here as they come in.", "تظهر هنا الطلبات عبر الإنترنت والهاتف فور وصولها."), `<button class="btn btn-sm">${icon("phone", 14)}${T("Take a phone order", "طلب هاتفي")}</button>`)),
        state("permission", T("Drivers see only their orders", "يرى السائق طلباته فقط"), denied(T("This board is for the store", "هذه اللوحة للمتجر"), T("Drivers use the driver app. Ask a manager for the Delivery permission.", "يستخدم السائقون تطبيق السائق. اطلب صلاحية التوصيل من المدير."), "")),
      ])}`,
    }),
  }

  // ── 14 Team & permissions ─────────────────────────────────────────────────
  const perms = [[T("Sell and take payments", "البيع وقبض المدفوعات"), true, true, true], [T("Discounts", "الخصومات"), T("up to 10%", "حتى 10%"), true, true], [T("Refunds", "الإرجاع"), false, true, true], [T("Void receipts", "إلغاء الإيصالات"), false, true, true], [T("Adjust stock and counts", "تعديل المخزون والجرد"), false, true, true], [T("Customers' debt", "ديون الزبائن"), T("view", "عرض"), true, true], [T("Money and reports", "المال والتقارير"), false, true, true], [T("Store settings and team", "الإعدادات والفريق"), false, false, true]]
  const cell = (v) => v === true ? `<span class="badge t-ok">${icon("check", 12)}${T("Yes", "نعم")}</span>` : v === false ? `<span class="badge t-mute">${icon("minus", 12)}${T("No", "لا")}</span>` : `<span class="badge t-info">${v}</span>`
  S["14-team-permissions"] = {
    title: T("Admin · team & permissions", "الإدارة · الفريق والصلاحيات"),
    body: shell({
      active: "admin", crumb: T("Admin", "الإدارة"), page: T("Team & permissions", "الفريق والصلاحيات"), tabs: ADMIN_TABS, activeTab: "t",
      actions: `<button class="btn btn-sm">${icon("user-plus", 16)}${T("Add person", "إضافة شخص")}</button>`,
      capsuleHtml: synced,
      content: `
      <div class="cols-2b">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl cards-sm" style="min-width:560px"><thead><tr><th>${T("Person", "الشخص")}</th><th>${T("Role", "الدور")}</th><th>${T("Sign-in", "الدخول")}</th><th>${T("Last active", "آخر نشاط")}</th></tr></thead><tbody>
          ${[[T("Rami Fakih", "رامي فقيه"), T("Owner", "المالك"), statusBadge("ok", "key-round", T("PIN set", "رمز PIN مُعيّن")), T("now", "الآن")], [T("Maya Saad", "مايا سعد"), T("Cashier", "كاشير"), statusBadge("ok", "key-round", T("PIN set", "رمز PIN مُعيّن")), T("Register 1 · now", "الصندوق 1 · الآن")], [T("Ali Hamdan", "علي حمدان"), T("Manager", "مدير"), statusBadge("ok", "key-round", T("PIN set", "رمز PIN مُعيّن")), T("2 h ago", "قبل ساعتين")], [T("Jad Nasser", "جاد ناصر"), T("Driver", "سائق"), statusBadge("warn", "key-round", T("Sets PIN at first sign-in", "يعيّن الرمز عند أول دخول")), T("never", "أبداً")]].map((r, i) => `<tr class="${i === 1 ? "sel" : ""}"><td data-label="${T("Person", "الشخص")}" class="font-semibold">${r[0]}</td><td data-label="${T("Role", "الدور")}" style="color:var(--text-2)">${r[1]}</td><td data-label="${T("Sign-in", "الدخول")}">${r[2]}</td><td data-label="${T("Last active", "آخر نشاط")}" class="cap">${r[3]}</td></tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="overflow:hidden" aria-labelledby="pm-title">
          ${head(`<span id="pm-title">${T("What each role can do", "ما يمكن لكل دور فعله")}</span>`, T("Changes apply at the next sign-in on every register.", "تُطبق التغييرات عند الدخول التالي على كل صندوق."))}
          <div class="scroll-x"><table class="tbl" style="min-width:440px"><thead><tr><th>${T("Permission", "الصلاحية")}</th><th>${T("Cashier", "كاشير")}</th><th>${T("Manager", "مدير")}</th><th>${T("Owner", "المالك")}</th></tr></thead><tbody>
          ${perms.map(([p, a, b, c]) => `<tr><td>${p}</td><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(c)}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
      </div>
      ${board([
        state("dialog", T("Add a person", "إضافة شخص"), `
          ${input(T("Name", "الاسم"), T("Lina Haddad", "لينا حداد"))}
          <label style="display:block"><span class="label">${T("Mobile", "الجوال")}</span><input class="field num" dir="ltr" inputmode="tel" value="03 557 210"></label>
          ${seg("role", T("Role", "الدور"), [[T("Cashier", "كاشير")], [T("Manager", "مدير")], [T("Driver", "سائق")]], 0, 3)}
          <div class="cap">${T("Lina chooses her own PIN the first time she signs in. Nobody else sees it.", "تختار لينا رمز PIN بنفسها عند أول دخول. لا يراه أحد غيرها.")}</div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-primary">${T("Add Lina", "أضف لينا")}</button>`),
        state("error", T("Can't remove the last owner", "لا يمكن إزالة آخر مالك"), `
          <div class="banner t-err" role="alert">${icon("circle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Rami is the only owner", "رامي هو المالك الوحيد")}</div><div class="cap" style="color:var(--text-2)">${T("A store always needs one owner. Make someone else owner first.", "يحتاج المتجر دائماً إلى مالك. اجعل شخصاً آخر مالكاً أولاً.")}</div></div></div>`,
          `<button class="btn btn-sm">${T("Make Ali owner", "اجعل علي مالكاً")}</button>`),
        state("dialog", T("Reset Maya's PIN?", "إعادة تعيين رمز مايا؟"), `<div class="cap">${T("Maya is signed out on every register and picks a new PIN at her next sign-in. Her sales and shifts are kept.", "تُسجَّل مايا خروجاً من كل الصناديق وتختار رمزاً جديداً عند دخولها التالي. تبقى مبيعاتها ووردياتها.")}</div>`,
          `<button class="btn">${T("Cancel", "إلغاء")}</button><button class="btn btn-danger">${T("Reset PIN", "إعادة تعيين الرمز")}</button>`),
        state("permission", T("Managers can't change permissions", "لا يغيّر المدير الصلاحيات"), denied(T("Only owners change the team", "المالكون فقط يغيّرون الفريق"), T("You can see who is on the team. Ask Rami to add people or change roles.", "يمكنك رؤية الفريق. اطلب من رامي إضافة أشخاص أو تغيير الأدوار."), "")),
      ])}`,
    }),
  }

  // ── 15 About & updates ────────────────────────────────────────────────────
  S["15-about-updates"] = {
    title: T("Admin · about & updates", "الإدارة · حول والتحديثات"),
    body: shell({
      active: "admin", crumb: T("Admin", "الإدارة"), page: T("About & updates", "حول والتحديثات"), tabs: ADMIN_TABS, activeTab: "a",
      capsuleHtml: synced,
      content: `
      <div class="cols-2b">
        <div class="stack">
          <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px" aria-labelledby="up-title">
            <div class="flex items-center gap-3" style="flex-wrap:wrap">${logo(44)}<div style="flex:1;min-width:0"><h2 id="up-title" class="sub" style="margin:0">${T("Update ready: Titan POS 1.0.50", "تحديث جاهز: Titan POS 1.0.50")}</h2><div class="cap num">${T("This register runs 1.0.49 · downloaded 2 h ago · 84 MB", "هذا الصندوق يعمل بـ 1.0.49 · نُزّل قبل ساعتين · 84 م.ب")}</div></div>${statusBadge("info", "download", T("Ready to install", "جاهز للتثبيت"))}</div>
            <div class="inset" style="padding:14px"><div class="font-semibold" style="margin-bottom:6px">${T("What's new", "ما الجديد")}</div><ul style="margin:0;padding-inline-start:18px;color:var(--text-2);display:flex;flex-direction:column;gap:4px"><li>${T("Refunds use the exact lots and the sale's original rate.", "تستخدم المرتجعات الدفعات نفسها وسعر البيع الأصلي.")}</li><li>${T("Rejected offline refunds stay visible until a manager settles them.", "تبقى المرتجعات المرفوضة ظاهرة حتى يسوّيها مدير.")}</li><li>${T("Two registers can no longer clash on adjustment numbers.", "لم يعد يتعارض صندوقان على أرقام التعديل.")}</li></ul></div>
            <div class="cap">${T("Installing restarts the app (about 1 minute). Unsent sales are kept and sent after the restart.", "يعيد التثبيت تشغيل التطبيق (دقيقة تقريباً). تُحفظ المبيعات غير المرسلة وتُرسل بعد إعادة التشغيل.")}</div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn">${T("Install at close of day", "التثبيت عند إقفال اليوم")}</button><button class="btn btn-primary">${icon("rotate-cw", 16)}${T("Restart and install now", "أعد التشغيل وثبّت الآن")}</button></div>
          </section>
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-labelledby="ver-title">
            <h2 id="ver-title" class="sub" style="margin:0">${T("Versions in this store", "الإصدارات في هذا المتجر")}</h2>
            ${[[T("Store hub (this PC)", "خادم المتجر (هذا الجهاز)"), "1.0.49", "ok"], [T("Register 2", "الصندوق 2"), "1.0.47", "warn"], [T("Maya's phone", "هاتف مايا"), "1.0.49", "ok"]].map(([n, v, t]) => `<div class="flex items-center gap-3" style="padding:6px 0;border-top:1px solid var(--border)"><span style="flex:1">${n}</span><span class="num font-semibold">${v}</span>${t === "warn" ? statusBadge("warn", "triangle-alert", T("Behind", "متأخر")) : statusBadge("ok", "check", T("Current", "حالي"))}</div>`).join("")}
            <div class="cap">${T("Update the store hub before the registers that connect to it.", "حدّث خادم المتجر قبل الصناديق المتصلة به.")}</div>
          </section>
        </div>
        <div class="stack">
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-labelledby="lic-title">
            <h2 id="lic-title" class="sub" style="margin:0">${T("Licence", "الترخيص")}</h2>
            ${kv([[T("Plan", "الخطة"), T("Store · 3 registers", "متجر · 3 صناديق")], [T("Renews", "يتجدد"), T("20 Oct 2026", "20 تشرين الأول 2026")], [T("Store ID", "معرّف المتجر"), "fakih-hamra"]])}
          </section>
          <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-labelledby="sup-title">
            <h2 id="sup-title" class="sub" style="margin:0">${T("Help", "المساعدة")}</h2>
            <button class="btn btn-sm" style="justify-content:flex-start">${icon("file-down", 14)}${T("Save a diagnostics file", "حفظ ملف تشخيص")}</button>
            <button class="btn btn-sm" style="justify-content:flex-start">${icon("message-circle", 14)}${T("WhatsApp support", "دعم واتساب")}</button>
            <div class="cap">${T("The diagnostics file has no PINs or passwords.", "لا يحتوي ملف التشخيص على رموز أو كلمات مرور.")}</div>
          </section>
        </div>
      </div>
      ${board([
        state("progress", T("Downloading the update", "جارٍ تنزيل التحديث"), `<div class="flex justify-between cap num"><span>1.0.50 · 52 / 84 MB</span><span>${T("about 1 min left", "بقيت دقيقة تقريباً")}</span></div><div style="height:6px;border-radius:999px;background:var(--surface-3)" role="progressbar" aria-valuenow="62" aria-valuemax="100" aria-label="${T("Download progress", "تقدم التنزيل")}"><div style="width:62%;height:6px;border-radius:999px;background:var(--info)"></div></div><div class="cap">${T("You can keep selling while it downloads.", "يمكنك متابعة البيع أثناء التنزيل.")}</div>`),
        state("error", T("Update failed", "فشل التحديث"), `<div class="banner t-err" role="alert">${icon("circle-alert", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("The download was interrupted", "توقف التنزيل")}</div><div class="cap" style="color:var(--text-2)">${T("Nothing changed: this register still runs 1.0.49 and keeps working.", "لم يتغير شيء: لا يزال الصندوق يعمل بـ 1.0.49 ويواصل العمل.")}</div></div></div>`,
          `<button class="btn btn-sm">${icon("file-down", 14)}${T("Save diagnostics", "حفظ التشخيص")}</button><button class="btn btn-primary btn-sm">${icon("refresh-cw", 14)}${T("Try again", "حاول مجدداً")}</button>`),
        state("warning", T("Offline: can't check for updates", "غير متصل: تعذّر التحقق من التحديثات"), `<div class="cap">${T("Last checked yesterday at 21:04. The app checks again when the internet is back.", "آخر تحقق أمس الساعة 21:04. يتحقق التطبيق مجدداً عند عودة الإنترنت.")}</div>`),
        state("done", T("Up to date", "محدّث"), `<div class="flex items-center gap-3">${icon("circle-check", 22, "var(--ok)")}<div><div class="font-semibold">${T("Titan POS 1.0.50 is the latest version", "Titan POS 1.0.50 هو أحدث إصدار")}</div><div class="cap">${T("Checked 5 min ago", "تحقق قبل 5 دقائق")}</div></div></div>`),
        state("permission", T("Cashiers can't install updates", "لا يثبّت الكاشير التحديثات"), `<div class="flex items-center gap-2" style="flex-wrap:wrap"><button class="btn btn-sm" disabled aria-describedby="up-perm">${icon("lock", 14)}${T("Restart and install now", "أعد التشغيل وثبّت الآن")}</button><span id="up-perm" class="cap">${T("Only owners and managers install updates.", "المالكون والمدراء فقط يثبّتون التحديثات.")}</span></div>`),
      ])}`,
    }),
  }

  // ── 16 Lock screen ────────────────────────────────────────────────────────
  const pad = (digits = 2, err = false, disabled = false) => `
    <div class="flex gap-3 justify-center" dir="ltr" role="img" aria-label="${T(`${digits} of 4 digits entered`, `أُدخل ${digits} من 4 أرقام`)}">${[0, 1, 2, 3].map((i) => `<span style="width:16px;height:16px;border-radius:999px;${i < digits ? `background:${err ? "var(--err)" : "var(--text)"}` : "border:2px solid var(--border-input)"}"></span>`).join("")}</div>
    <div dir="ltr" style="display:grid;grid-template-columns:repeat(3,72px);gap:12px;justify-content:center">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k) => k ? `<button class="btn num" style="min-height:64px;font-size:24px;border-radius:999px"${disabled ? " disabled" : ""}${k === "⌫" ? ` aria-label="${T("Delete digit", "حذف رقم")}"` : ""}>${k === "⌫" ? icon("delete", 22) : k}</button>` : "<span></span>").join("")}</div>`
  S["16-lock-screen"] = {
    title: T("Lock screen", "شاشة القفل"),
    body: `<a class="skip" href="#pin">${T("Skip to PIN", "انتقل إلى الرمز")}</a>
    <div style="min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)" class="lock-grid">
      <main style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px 16px" aria-labelledby="lock-title">
        <div class="flex items-center gap-3">${logo(40)}<div><div class="font-semibold">${T("Fakih Market", "سوبرماركت فقيه")}</div><div class="cap">${T("Register 1 · Hamra", "الصندوق 1 · الحمرا")}</div></div></div>
        <div class="num" style="font-size:44px;font-weight:600;line-height:48px">14:36</div>
        <div role="radiogroup" aria-label="${T("Who is signing in", "من يسجّل الدخول")}" class="flex gap-2" style="flex-wrap:wrap;justify-content:center">${[[T("Maya", "مايا"), "MS", true], [T("Ali", "علي"), "AH", false], [T("Rami", "رامي"), "RF", false]].map(([n, ini, on]) => `<label class="chip" style="min-height:48px;padding:0 14px 0 6px${on ? ";background:var(--brand-soft);border-color:var(--brand-border);color:var(--text)" : ""}"><input type="radio" name="who" class="sr-only"${on ? " checked" : ""}><span style="width:36px;height:36px;border-radius:999px;background:var(--surface-3);display:grid;place-items:center;color:var(--text)" class="font-semibold">${ini}</span>${n}</label>`).join("")}</div>
        <h1 id="lock-title" class="title" style="margin:0">${T("Maya, enter your PIN", "مايا، أدخلي رمز PIN")}</h1>
        <div id="pin" style="display:flex;flex-direction:column;gap:20px">${pad(2)}</div>
        <div class="flex gap-2"><button class="btn btn-ghost">${icon("languages", 16)}${T("عربي", "EN")}</button><button class="btn btn-ghost">${icon("users", 16)}${T("Someone else", "شخص آخر")}</button></div>
        <div class="cap meta">${T("Shift #42 stays open while the register is locked.", "تبقى الوردية #42 مفتوحة أثناء قفل الصندوق.")}</div>
      </main>
      <aside style="background:var(--surface);border-inline-start:1px solid var(--border);padding:24px;display:flex;flex-direction:column;gap:16px;overflow:auto" aria-label="${T("States on this page", "حالات هذه الصفحة")}">
        <div><h2 class="title" style="margin:0">${T("States on this page", "حالات هذه الصفحة")}</h2><p class="cap" style="margin:2px 0 0">${T("Shown side by side for review.", "معروضة للمراجعة.")}</p></div>
        ${state("error", T("Wrong PIN", "رمز خاطئ"), `<div class="flex flex-col gap-3">${pad(4, true)}</div><span class="error" role="alert" style="justify-content:center">${icon("circle-alert", 14)}${T("Wrong PIN. 2 tries left before a 1-minute wait.", "رمز خاطئ. بقيت محاولتان قبل انتظار دقيقة.")}</span>`)}
        ${state("warning", T("Too many tries", "محاولات كثيرة"), `<div class="banner t-warn" role="status">${icon("timer", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Try again in 0:45", "حاول مجدداً بعد 0:45")}</div><div class="cap" style="color:var(--text-2)">${T("A manager can unlock now with their PIN.", "يمكن للمدير فتح القفل الآن برمزه.")}</div></div></div>`, `<button class="btn btn-sm">${icon("key-round", 14)}${T("Manager unlock", "فتح بواسطة المدير")}</button>`)}
        ${state("warning", T("Offline", "غير متصل"), `<div class="banner t-warn" role="status">${icon("cloud-off", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Offline: PINs still work on this register", "غير متصل: الرموز تعمل على هذا الصندوق")}</div><div class="cap" style="color:var(--text-2)">${T("People added on another device today can't sign in here until it reconnects.", "من أُضيف اليوم على جهاز آخر لا يمكنه الدخول هنا حتى يعود الاتصال.")}</div></div></div>`)}
        ${state("permission", T("Read-only store", "متجر للقراءة فقط"), `<div class="banner t-err" role="status">${icon("lock", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Selling is off: the licence has ended", "البيع متوقف: انتهى الترخيص")}</div><div class="cap" style="color:var(--text-2)">${T("Owners can still sign in to see reports and export data.", "يمكن للمالكين الدخول لعرض التقارير وتصدير البيانات.")}</div></div></div>`)}
      </aside>
    </div>
    <style>@media (max-width:899px){.lock-grid{grid-template-columns:minmax(0,1fr)!important}.lock-grid aside{border-inline-start:0!important;border-top:1px solid var(--border)}}</style>`,
  }

  // ── 17 First setup ────────────────────────────────────────────────────────
  const steps = [[T("Store", "المتجر"), "done"], [T("Money & tax", "المال والضرائب"), "on"], [T("Products", "المنتجات"), ""], [T("Team", "الفريق"), ""], [T("Registers & printer", "الصناديق والطابعة"), ""]]
  S["17-first-setup"] = {
    title: T("First setup", "الإعداد الأول"),
    body: `<a class="skip" href="#setup-step">${T("Skip to the form", "انتقل إلى النموذج")}</a>
    <div style="min-height:100vh;display:flex;flex-direction:column">
      <header class="flex items-center gap-3" style="padding:14px 24px;border-bottom:1px solid var(--border);flex-wrap:wrap">${logo(32)}<span class="font-semibold">${T("Set up Fakih Market", "إعداد سوبرماركت فقيه")}</span><span class="cap" style="margin-inline-start:auto">${T("Step 2 of 5 · about 6 minutes left", "الخطوة 2 من 5 · بقيت 6 دقائق تقريباً")}</span><button class="btn btn-ghost btn-sm">${icon("languages", 16)}${T("عربي", "EN")}</button></header>
      <div class="cols-side" style="padding:24px;grid-template-columns:240px minmax(0,1fr);max-width:1280px;width:100%;margin:0 auto" id="setup-grid">
        <nav aria-label="${T("Setup steps", "خطوات الإعداد")}" class="card" style="padding:12px;display:flex;flex-direction:column;gap:4px;align-self:start">
          ${steps.map(([n, st], i) => `<a href="?step=${i + 1}" class="flex items-center gap-3" style="min-height:44px;padding:0 10px;border-radius:8px;text-decoration:none;color:${st === "on" ? "var(--text)" : "var(--text-2)"};font-weight:600${st === "on" ? ";background:var(--brand-soft);box-shadow:inset 3px 0 0 var(--brand)" : ""}"${st === "on" ? ' aria-current="step"' : ""}><span style="width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:12px;${st === "done" ? "background:var(--ok-soft);color:var(--ok)" : st === "on" ? "background:var(--brand);color:var(--brand-contrast)" : "border:1px solid var(--border-input)"}" class="num">${st === "done" ? icon("check", 14) : i + 1}</span>${n}</a>`).join("")}
        </nav>
        <main id="setup-step" class="stack" aria-labelledby="step-title">
          <section class="card" style="padding:24px;display:flex;flex-direction:column;gap:16px">
            <div><h1 id="step-title" class="title" style="margin:0">${T("Money & tax", "المال والضرائب")}</h1><p class="cap" style="margin:4px 0 0">${T("Receipts show both currencies. You can change all of this later in Store settings.", "تُظهر الإيصالات العملتين. يمكنك تغيير كل هذا لاحقاً في إعدادات المتجر.")}</p></div>
            ${seg("price-cur", T("You price products in", "تسعّر المنتجات بـ"), [[T("US dollars", "الدولار"), "dollar-sign"], [T("Lebanese pounds", "الليرة اللبنانية"), "banknote"]], 0, 2)}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px">
              <label style="display:block"><span class="label">${T("Today's rate (LBP for $1)", "سعر اليوم (ل.ل لكل 1$)")}</span><input class="field num invalid" dir="ltr" inputmode="numeric" value="8,950" aria-invalid="true" aria-describedby="rate-err">${errLine("rate-err", T("That looks too low. Did you mean 89,500?", "يبدو منخفضاً جداً. هل تقصد 89,500؟"))}</label>
              <label style="display:block"><span class="label">${T("VAT (value added tax) %", "الضريبة على القيمة المضافة %")}</span><input class="field num" dir="ltr" inputmode="decimal" value="11"><span class="help" style="display:block">${T("Lebanon's standard rate is 11%.", "النسبة القياسية في لبنان 11%.")}</span></label>
            </div>
            ${select(T("Round cash payments in LBP", "تدوير المدفوعات النقدية بالليرة"), [T("Up to the nearest 5,000", "للأعلى إلى أقرب 5,000"), T("Up to the nearest 1,000", "للأعلى إلى أقرب 1,000"), T("No rounding", "بدون تدوير")])}
            <div class="inset" style="padding:12px"><div class="cap">${T("Example receipt line", "مثال على سطر الإيصال")}</div><div class="num font-semibold">$21.81 · ${lbp(1955000)} ${T("cash", "نقداً")}</div></div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn">${dirIcon("arrow-left", 16)}${T("Back", "رجوع")}</button><button class="btn btn-primary" style="margin-inline-start:auto">${T("Next: products", "التالي: المنتجات")}${dirIcon("arrow-right", 16)}</button></div>
          </section>
          ${board([
            state("error", T("Product import with problems", "استيراد منتجات فيه مشاكل"), `
              <div class="banner t-warn" role="alert">${icon("file-exclamation-point", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("1,281 of 1,284 rows are ready", "1,281 من 1,284 سطراً جاهزة")}</div><div class="cap" style="color:var(--text-2)">${T("3 rows need fixing. You can import the rest now and fix these later.", "3 أسطر تحتاج تصحيحاً. يمكنك استيراد البقية الآن وتصحيحها لاحقاً.")}</div></div></div>
              ${[[T("Row 88", "السطر 88"), T("Price is empty", "السعر فارغ")], [T("Row 412", "السطر 412"), T("Barcode 6281007030221 is used twice", "الباركود 6281007030221 مكرر")], [T("Row 977", "السطر 977"), T("Stock \"twelve\" is not a number", "المخزون \"twelve\" ليس رقماً")]].map(([r, e]) => `<div class="flex gap-3 cap"><span class="num font-semibold" style="color:var(--text);width:72px">${r}</span><span style="color:var(--err)">${e}</span></div>`).join("")}`,
              `<button class="btn btn-sm">${icon("file-down", 14)}${T("Download the 3 rows", "تنزيل الأسطر الثلاثة")}</button><button class="btn btn-primary btn-sm">${T("Import 1,281 products", "استيراد 1,281 منتجاً")}</button>`),
            state("warning", T("Setting up offline", "الإعداد دون اتصال"), `<div class="banner t-warn" role="status">${icon("cloud-off", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("You can finish setup offline", "يمكنك إكمال الإعداد دون اتصال")}</div><div class="cap" style="color:var(--text-2)">${T("Everything is saved here and sent to your account when the internet is back.", "يُحفظ كل شيء هنا ويُرسل إلى حسابك عند عودة الإنترنت.")}</div></div></div>`),
            state("empty", T("Start without products", "البدء بلا منتجات"), empty("package-open", T("No products yet", "لا منتجات بعد"), T("Import a spreadsheet, or add products as you scan them at the register.", "استورد جدولاً أو أضف المنتجات أثناء مسحها في الصندوق."), `<div class="flex gap-2" style="flex-wrap:wrap;justify-content:center"><button class="btn btn-sm">${icon("upload", 14)}${T("Import spreadsheet", "استيراد جدول")}</button><button class="btn btn-sm">${T("Skip for now", "تخطَّ الآن")}</button></div>`)),
            state("done", T("Setup finished", "اكتمل الإعداد"), `<div class="flex items-center gap-3">${icon("party-popper", 22, "var(--ok)")}<div><div class="font-semibold">${T("Fakih Market is ready to sell", "سوبرماركت فقيه جاهز للبيع")}</div><div class="cap">${T("Next: open the first shift and count the starting cash.", "التالي: افتح الوردية الأولى وعدّ النقد الافتتاحي.")}</div></div></div>`, `<button class="btn btn-primary btn-sm">${T("Open the register", "افتح الصندوق")}</button>`),
          ])}
        </main>
      </div>
    </div>
    <style>@media (max-width:899px){#setup-grid{grid-template-columns:minmax(0,1fr)!important;padding:16px!important}}</style>`,
  }

  Object.defineProperty(S, "__helpers", { enumerable: false, value: { state, board, empty, denied, errLine, kv, statusBadge, head, closeBtn, search, select, input } })
  return S
}
