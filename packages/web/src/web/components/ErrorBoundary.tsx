import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

/**
 * Empêche qu'une erreur de rendu React fasse disparaître toute l'app (la
 * fameuse « page grise » vide). Au lieu de démonter tout l'arbre, on affiche
 * un écran de secours avec un bouton pour recharger.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
	}

	handleReload = () => {
		this.setState({ hasError: false, error: undefined });
		window.location.reload();
	};

	handleGoHome = () => {
		this.setState({ hasError: false, error: undefined });
		window.location.href = "/";
	};

	render() {
		if (this.state.hasError) {
			return (
				<div
					style={{
						minHeight: "100vh",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						gap: "16px",
						padding: "24px",
						textAlign: "center",
						background: "var(--surface-0, #0f0f11)",
						color: "var(--text-secondary, #f5f5f5)",
						fontFamily: "inherit",
					}}
				>
					{/* Remplace l'ancienne icône ⚠️ : anneau monochrome dessiné au trait,
					    qui respire doucement. Aucune couleur, aucun emoji. */}
					<svg
						width="46"
						height="46"
						viewBox="0 0 46 46"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						className="animate-error-pulse"
						style={{ color: "var(--text-ghost, rgba(255,255,255,0.35))" }}
					>
						<circle cx="23" cy="23" r="17" strokeDasharray="4 5" />
						<path d="M23 15.5V25" />
						<path d="M23 30.2V30.6" />
					</svg>
					<h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
						Something didn't load
					</h1>
					<p
						style={{
							fontSize: "14px",
							lineHeight: 1.6,
							maxWidth: "420px",
							margin: 0,
							color: "var(--text-dim, rgba(255,255,255,0.55))",
						}}
					>
						The display ran into an unexpected problem. Your data is saved —
						reload the page to continue.
					</p>
					<div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
						<button
							onClick={this.handleReload}
							style={{
								height: "38px",
								padding: "0 20px",
								borderRadius: "10px",
								border: "1px solid var(--border-default, rgba(255,255,255,0.1))",
								background: "var(--surface-4, rgba(255,255,255,0.07))",
								color: "var(--text-secondary, #f5f5f5)",
								fontSize: "13px",
								fontWeight: 500,
								cursor: "pointer",
							}}
						>
							Reload
						</button>
						<button
							onClick={this.handleGoHome}
							style={{
								height: "38px",
								padding: "0 16px",
								borderRadius: "10px",
								border: "1px solid transparent",
								background: "transparent",
								color: "var(--text-dim, rgba(255,255,255,0.55))",
								fontSize: "13px",
								fontWeight: 500,
								cursor: "pointer",
							}}
						>
							Go home
						</button>
					</div>
					{this.state.error?.message ? (
						<div
							style={{
								marginTop: "10px",
								fontSize: "11px",
								fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
								color: "var(--text-ghost, rgba(255,255,255,0.3))",
								maxWidth: "420px",
								wordBreak: "break-word",
							}}
						>
							{this.state.error.message}
						</div>
					) : null}
				</div>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
