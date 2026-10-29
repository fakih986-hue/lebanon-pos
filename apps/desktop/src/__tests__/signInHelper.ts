// Tests that exercise catalogue services need a signed-in user allowed to manage the catalogue:
// since SPRINT-0 createProduct / updateProduct check the current user's permissions, as the app does.
export function signInCatalogManager() {
  window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([
    { id: "u-test-manager", name: "Test manager", role: "Manager", pin: "x", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  window.localStorage.setItem("lebanonpos.current-user.v1", "u-test-manager")
}
