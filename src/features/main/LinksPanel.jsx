function LinksPanel({ openVisto, openPip, openBitrix, openClaro, openLinks, footer }) {
  return (
    <div className="card">
      <div className="actions-grid">
        <button className="btn btn-outline" onClick={openVisto}>Abrir Visto</button>
        <button className="btn btn-outline" onClick={openPip}>Abrir Pip</button>
        <button className="btn btn-outline" onClick={openBitrix}>Abrir Bitrix</button>
        <button className="btn btn-outline" onClick={openClaro}>Visto Claro</button>
        <button className="btn btn-primary" onClick={openLinks}>Abrir Todos</button>
      </div>
      {footer}
    </div>
  );
}

export default LinksPanel;
