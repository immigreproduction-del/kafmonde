# Kafmonde pour Windows

Le Kafmonde dans sa propre fenêtre. L'appli ouvre le jeu en ligne (https://immigreprod.pages.dev/monde/) :
**une mise à jour du jeu ne demande pas de nouvel installeur**, les joueurs cliquent sur ⟳ (ou F5).

Ce que fait l'appli :

- sa page de connexion (se konnecter ou créer un kompte, le même que sur le site), gardée d'une fois sur l'autre ;
- une page « hors ligne » qui réessaie toute seule quand il n'y a pas d'internet ;
- F5 ou Ctrl+R recharger, F11 plein écran, Ctrl + / Ctrl − / Ctrl 0 le zoom, F12 les outils de développement ;
- la taille, la place et le zoom de la fenêtre sont gardés ; une seule fenêtre à la fois ;
- la musique démarre sans clic ; les liens vers le reste du site s'ouvrent dans le navigateur ;
- copier-coller au clic droit dans le tchat ;
- l'appli se met à jour toute seule quand une nouvelle version est publiée (voir plus bas).

## Essayer

```
npm install
node node_modules/electron/install.js
npm start
```

npm bloque le script d'installation d'Electron : la deuxième ligne télécharge le moteur Electron.
`npm run local` ouvre l'appli sur le banc de test local (http://127.0.0.1:8788/monde/?as=zorglub).

## Fabriquer l'installeur

```
npm run installeur
```

Résultat dans `dist/` : `Kafmonde-Setup.exe` (le fichier à partager), `latest.yml` et `Kafmonde-Setup.exe.blockmap`.
L'installeur s'installe en un clic, sans droits administrateur, crée les raccourcis Bureau et menu Démarrer,
et se désinstalle depuis Paramètres > Applications. Il n'est pas signé : Windows affiche « Windows a protégé
votre ordinateur », il faut cliquer sur « Informations complémentaires » puis « Exécuter quand même ».

## Où la télécharger

https://github.com/immigreproduction-del/kafmonde/releases/latest/download/Kafmonde-Setup.exe

(le dépôt GitHub public `immigreproduction-del/kafmonde`, qui garde aussi ce dossier).

## Publier une nouvelle version de l'appli

Seulement si ce dossier change (main.js, preload.js, les pages, l'icône) :

1. monter `version` dans `package.json` (1.0.0 → 1.0.1) ;
2. `npm run installeur` ;
3. pousser ce dossier, puis créer la Release avec les trois fichiers de `dist/` :

```
gh release create v1.0.1 dist/Kafmonde-Setup.exe dist/Kafmonde-Setup.exe.blockmap dist/latest.yml --title "Kafmonde 1.0.1" --notes "Ce qui change."
```

Les applis installées regardent la dernière Release au lancement puis toutes les 6 heures, téléchargent la nouvelle
version et proposent de redémarrer (sinon elle s'installe à la fermeture). L'installeur fait environ 100 Mo :
trop gros pour Cloudflare Pages (25 Mo par fichier), d'où GitHub.
