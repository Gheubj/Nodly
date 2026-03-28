import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import { App } from "@/app/App";
import "@/app/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={ruRU}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
