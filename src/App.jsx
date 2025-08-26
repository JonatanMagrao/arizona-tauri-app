import { useState } from "react";
import { callFunction } from "tauri-plugin-python-api";
import "./App.css";

function App() {
  const [jobaoCod, setJobaoCod] = useState('');
  const [jobinhoCod, setJobinhoCod] = useState('');

  const openVisto = async () => await callFunction("openVisto", []);
  const openPip = async () => await callFunction("openPip", []);
  const openBitrix = async () => await callFunction("openBitrix", []);
  const openClaro = async () => await callFunction("openClaro", []);
  const openLinks = async () => await callFunction("openLinks", []);
  const openJobao = async () => await callFunction("openJobao", [jobaoCod])
  const openJobinho = async () => await callFunction("openJobinho", [jobaoCod, jobinhoCod])
  const abrirAE = async () => await callFunction("abrirAE", [jobaoCod, jobinhoCod])


  return (
    <div className="container">
      <h1 className="title">Atalhos de Job</h1>

      <div className="card">
        <div className="form-row">
          <label className="label" htmlFor="jobao">Cod Jobão</label>
          <input
            id="jobao"
            className="input"
            type="text"
            name="jobao"
            value={jobaoCod}
            onChange={(e) => setJobaoCod(e.target.value)}
            placeholder="Ex: 12345"
          />
          <button className="btn" onClick={openJobao} disabled={!jobaoCod.trim()}>
            Buscar
          </button>
        </div>

        <div className="form-row">
          <label className="label" htmlFor="jobinho">Cod Jobinho</label>
          <input
            id="jobinho"
            className="input"
            type="text"
            name="jobinho"
            value={jobinhoCod}
            onChange={(e) => setJobinhoCod(e.target.value)}
            placeholder="Ex: A-001"
          />
          <div className="btn-group">
            <button className="btn" onClick={openJobinho} disabled={!jobaoCod.trim() || !jobinhoCod.trim()}>
              Buscar
            </button>
            <button className="btn btn-secondary" onClick={abrirAE} disabled={!jobaoCod.trim() || !jobinhoCod.trim()}>
              Abrir AE
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="actions-grid">
          <button className="btn btn-outline" onClick={openVisto}>Abrir Visto</button>
          <button className="btn btn-outline" onClick={openPip}>Abrir Pip</button>
          <button className="btn btn-outline" onClick={openBitrix}>Abrir Bitrix</button>
          <button className="btn btn-outline" onClick={openClaro}>Abrir Claro</button>
          <button className="btn btn-primary" onClick={openLinks}>Abrir Todos</button>
        </div>
      </div>
    </div>
  );
}

export default App;
