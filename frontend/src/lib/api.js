import axios from "axios";

const BACKEND_URL = process.env.https://api.thefitcoach.in
;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});
