/**
 * Traduction des erreurs d'API des plateformes en messages actionnables.
 *
 * [2026-09-13] Avant, l'UI affichait le JSON brut renvoyé par X, du genre
 * `Twitter post failed (402): {"detail":"credits depleted",...}`, ce qui ne dit
 * pas à l'utilisateur quoi faire. Chaque cas connu est mappé ici sur une
 * phrase claire + l'action concrète à mener.
 */

export interface PublishErrorInfo {
  /** Message court et actionnable, affichable tel quel dans l'UI. */
  message: string;
  /** Code stable pour la logique côté client / les tests. */
  code:
    | 'credits_depleted'
    | 'rate_limited'
    | 'token_invalid'
    | 'forbidden'
    | 'duplicate'
    | 'too_long'
    | 'not_connected'
    | 'unknown';
  /** Le problème vient du compte développeur / de la plateforme, pas du contenu. */
  accountIssue: boolean;
  /** Lien vers l'endroit où l'utilisateur règle le problème, si connu. */
  fixUrl?: string;
}

/**
 * `raw` est le message d'erreur brut levé par un adaptateur de plateforme,
 * p.ex. `Twitter post failed (402): {"detail":"credits depleted",...}`.
 */
export function explainPublishError(raw: string, platform = 'la plateforme'): PublishErrorInfo {
  const text = (raw || '').toLowerCase();
  const label = platform === 'twitter' ? 'X' : platform;

  // X est passé au paiement à l'usage : un projet sans crédits renvoie 402
  // sur POST /2/tweets, même sur le palier gratuit et même sans aucun post.
  if (text.includes('credits-depleted') || text.includes('credits depleted') || / \(402\)/.test(text)) {
    return {
      code: 'credits_depleted',
      accountIssue: true,
      message:
        `Le post n'a pas été envoyé : ton projet développeur ${label} n'a plus de crédits d'API ` +
        `(erreur 402 « credits depleted »). L'API ${label} est facturée à l'usage — recharge le solde ` +
        `dans la console développeur (Billing → Purchase Credits), puis relance la publication. ` +
        `Le texte généré est conservé, rien n'est perdu.`,
      fixUrl: 'https://developer.x.com/en/portal/dashboard',
    };
  }

  if (text.includes('(429)') || text.includes('too many requests') || text.includes('rate limit')) {
    return {
      code: 'rate_limited',
      accountIssue: true,
      message:
        `${label} a refusé le post : limite de débit atteinte (429). Attends la fin de la fenêtre de ` +
        `quota puis relance la publication. Le texte généré est conservé.`,
    };
  }

  if (
    text.includes('unsupported authentication') ||
    text.includes('(401)') ||
    text.includes('invalid or expired token') ||
    text.includes('demo_token')
  ) {
    return {
      code: 'token_invalid',
      accountIssue: true,
      message:
        `Le post n'a pas été envoyé : la connexion ${label} n'est plus valide (jeton expiré, révoqué ` +
        `ou de démonstration). Déconnecte puis reconnecte ${label} pour obtenir un vrai jeton, et relance.`,
    };
  }

  if (text.includes('duplicate')) {
    return {
      code: 'duplicate',
      accountIssue: false,
      message: `${label} a refusé le post : ce contenu a déjà été publié. Régénère un texte différent.`,
    };
  }

  if (text.includes('(403)') || text.includes('not permitted')) {
    return {
      code: 'forbidden',
      accountIssue: true,
      message:
        `${label} a refusé le post (403). Vérifie que ton app a bien les droits en écriture ` +
        `(« Read and write ») dans les réglages d'authentification, puis reconnecte le compte.`,
      fixUrl: platform === 'twitter' ? 'https://developer.x.com/en/portal/dashboard' : undefined,
    };
  }

  if (text.includes('too long') || text.includes('280')) {
    return {
      code: 'too_long',
      accountIssue: false,
      message: `${label} a refusé le post : contenu trop long. Régénère une version plus courte.`,
    };
  }

  if (text.includes('no active') && text.includes('connection')) {
    return {
      code: 'not_connected',
      accountIssue: true,
      message: `Aucune connexion ${label} active. Connecte le compte avant de publier.`,
    };
  }

  return {
    code: 'unknown',
    accountIssue: false,
    message: `Le post n'a pas été envoyé. ${label} a répondu : ${raw}`,
  };
}
