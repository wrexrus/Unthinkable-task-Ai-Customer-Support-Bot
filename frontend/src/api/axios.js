import axios from "axios";

const instance = axios.create({
  baseURL: "http://localhost:4000/api", 
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

export default instance;
