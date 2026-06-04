import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import Admin from "./pages/Admin";
import Professor from "./pages/Professor";
import Pedagoga from "./pages/Pedagoga";

import PrivateRoute from "./components/PrivateRoute";
import GlobalFooter from "./components/GlobalFooter";

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-content">
          <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/login" element={<Login />} />

        <Route
          path="/admin"
          element={
            <PrivateRoute cargosPermitidos={["administracao"]}>
              <Admin />
            </PrivateRoute>
          }
        />

        <Route
          path="/professor"
          element={
            <PrivateRoute cargosPermitidos={["professor"]}>
              <Professor />
            </PrivateRoute>
          }
        />

        <Route
          path="/pedagoga"
          element={
            <PrivateRoute cargosPermitidos={["pedagoga", "administracao"]}>
              <Pedagoga />
            </PrivateRoute>
          }
        />
          </Routes>
        </div>
        <GlobalFooter />
      </div>
    </BrowserRouter>
  );
}

export default App;