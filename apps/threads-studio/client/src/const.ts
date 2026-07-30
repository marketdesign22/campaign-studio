export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Google OAuth login. The server route mints the CSRF nonce cookie
// and redirects the browser to Google's consent screen; the callback sets the
// session cookie and returns to "/".
export const startLogin = () => {
  window.location.href = "/api/auth/google";
};
