import React from 'react';

/**
 * @module shared/components/ErrorBoundary
 * @description R10.4 — Último colchón contra pantallas blancas.
 *
 * Envuelve <App/> para que cualquier excepción lanzada durante el render
 * de un árbol React sea capturada y muestre una pantalla de error amigable
 * con opción de recargar — en lugar del <div id="root"></div> vacío que
 * deja Vite/React sin un boundary.
 *
 * Cubre los siguientes escenarios observados históricamente:
 *   - route/hook que recibe `undefined` y revienta al desestructurar
 *   - componente que llama a .map sobre null
 *   - lazy import fallido
 *   - errores en renders derivados de estados de auth inconsistentes
 *
 * NO captura errores asincrónicos (promesas rechazadas de fetch / mutations):
 * esos ya los toastea el interceptor de axios en api.js. Esto sólo atrapa
 * excepciones síncronas del render tree — el caso donde antes se quedaba
 * la pantalla en blanco.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crash:', error, info);
    this.setState({ info });
  }

  handleReload = () => {
    window.location.href = '/';
  };

  handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    const devDetails =
      import.meta && import.meta.env && import.meta.env.DEV
        ? (
          <details className="mt-4 text-left text-xs text-gray-600 bg-gray-50 rounded p-3">
            <summary className="cursor-pointer font-semibold">Detalle técnico (dev only)</summary>
            <pre className="whitespace-pre-wrap mt-2">{String(error?.stack || error)}</pre>
            {info?.componentStack && (
              <pre className="whitespace-pre-wrap mt-2 text-gray-500">{info.componentStack}</pre>
            )}
          </details>
        )
        : null;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-xl w-full bg-white rounded-lg shadow border border-gray-200 p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Algo falló al mostrar esta pantalla</h1>
          <p className="text-sm text-gray-600 mt-2">
            La operación que intentabas hacer no se completó, pero <b>tu sesión sigue activa</b>.
            Puedes volver al dashboard o recargar la página. Si el problema persiste, revisa la
            consola del navegador y reporta el detalle técnico al equipo.
          </p>
          <div className="flex items-center justify-center gap-2 mt-5">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={this.handleBack}
            >
              ← Volver
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={this.handleReload}
            >
              Ir al dashboard
            </button>
          </div>
          {devDetails}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
