# Task — Pubs IA belles comme Base44 (fini le tout-bleu)

## Fait
- [x] Réécrit charte esthétique "soft premium lumineux" dans AD_STUDIO_SYSTEM (ad-studio.ts section 3)
- [x] Checklist qualité + buildBriefPrompt maj (rendu clair, couleur qui change)
- [x] Backdrops.tsx GradientFill : aurore floue diffuse + base claire par défaut + isLight()
- [x] GradientContent.tsx : même traitement glow diffus clair
- [x] brandSchema défauts -> bg clair #f6f3ee, fg encre #1a1a2e
- [x] cardStyle -> verre givré clair, ombre douce
- [x] StatCard/DataTable cardBg défaut -> rgba(255,255,255,0.72)

## En cours
- [ ] AppUI : screenBg #0b1120 -> clair ; remplissages blancs -> encre translucide

## À faire
- [ ] tsc --noEmit motion-engine = 0
- [ ] Rendre 3 briefs opposés (SaaS clair, resto pêche, fitness menthe) via ad-video / CLI
- [ ] Extraire frames + lire pour valider : clair, couleur change 3x, 3 pubs différentes
- [ ] deliver
