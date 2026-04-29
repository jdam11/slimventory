import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true, // send httpOnly cookies automatically
  headers: { "Content-Type": "application/json" },
});

// Redirect to login on 401 (session expired / not logged in)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
