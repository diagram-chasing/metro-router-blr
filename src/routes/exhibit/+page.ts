// The flow is purely client-side state, but the map question makes runtime fetches,
// so prerendering the shell is fine. Keep CSR on for sessionStorage hydration.
export const prerender = true;
export const ssr = false;
