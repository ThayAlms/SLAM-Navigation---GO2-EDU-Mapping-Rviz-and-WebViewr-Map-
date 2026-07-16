function OracleButton({ onClick, isLoading = false, disabled = false }) {
  return (
    <button
      className="ui-button ui-button--primary oracle-button"
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
    >
      {isLoading ? "Enviando análise..." : "Capturar e analisar imagem"}
    </button>
  );
}

export default OracleButton;
