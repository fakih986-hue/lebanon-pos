import { NavLink, Outlet, useNavigate } from "react-router"
import { clearToken } from "../main"
import { useEffect, useState } from "react"

const navItems = [
  { to: "/admin/dashboard", label: "Dashboard", icon: "📊" },
  { to: "/admin/delivery", label: "Delivery", icon: "🚚" },
  { to: "/admin/customers", label: "Customers", icon: "👥" },
  { to: "/admin/products", label: "Products", icon: "📦" },
]

export function Layout() {
  const navigate = useNavigate()
  const [tenantName, setTenantName] = useState("")

  useEffect(() => {
    const stored = localStorage.getItem("lebanonpos.admin.tenant")
    if (stored) setTenantName(stored)
  }, [])

  function handleLogout() {
    clearToken()
    navigate("/admin/login")
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="w-56 bg-zinc-900 text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-zinc-700">
          <h1 className="font-bold text-lg">Lebanon POS</h1>
          <p className="text-xs text-zinc-400">{tenantName || "Admin Panel"}</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-zinc-700 text-white" : "text-zinc-300 hover:bg-zinc-800"
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-700">
          <button onClick={handleLogout} className="text-sm text-zinc-400 hover:text-white w-full text-left">
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
