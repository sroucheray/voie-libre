# Architecture – Voie Libre, planificateur de parcours vélo/trail open source

2026-11-07

## Vision et périmètre

Une application web et Android, open source, qui planifie des parcours vélo et trail, les exporte en GPX et reste utilisable sans réseau une fois le parcours créé.

- **Utilisateur de départ :** un cycliste (route, gravel) et traileur qui prépare ses sorties avant de les charger sur un Garmin ou un autre appareil.
- **Hypothèses :** interface bilingue (anglais d'abord, français ensuite), France d'abord pour les données, développement assisté par IA, projet personnel qui peut devenir communautaire.
- **Fonctions visées :** planification à la main (départ, arrivée, étapes), parcours proposés (boucles, A vers B, contraintes de distance et de dénivelé) avec plusieurs alternatives, modification à la main, sauvegarde, partage, export GPX, zones à éviter, hors-ligne.
- **Hors périmètre au départ :** navigation guidée en temps réel, calcul d'itinéraire sur le téléphone sans réseau, réseau social complet.

## Principes directeurs

Quatre règles guident tous les choix : ouvert, local d'abord, données partagées avec OSM, composants interchangeables.

1. **Ouvert :** code sous licence libre (AGPL), données et sources ouvertes en priorité, sources gratuites non ouvertes seulement en complément et jamais indispensables.
2. **Local d'abord :** les parcours vivent sur l'appareil par défaut. Le partage est une action volontaire, jamais automatique.
3. **Contribuer à OSM :** une donnée durablement fausse est signalée à OpenStreetMap plutôt que corrigée seulement chez nous. Le temporaire (travaux) reste dans la couche de l'application.
4. **Fournisseurs interchangeables :** routage, géocodage, tuiles et relief passent par des interfaces. On change de moteur sans réécrire l'application.

**Bilingue, anglais d'abord :** l'interface est en anglais par défaut et traduite en français, sans aucune chaîne écrite en dur dans le code. L'API renvoie des codes d'erreur que l'application traduit. Le code, la documentation et les messages de commit sont en anglais. Les unités sont métriques par défaut, avec une option en miles prévue plus tard.

## Choix technologiques

Le front est une PWA empaquetée en APK par Capacitor : un seul code pour le site et l'application Android.

| Option              | Site web             | Carte (MapLibre)          | Rendu natif | Effort | Verdict             |
| ------------------- | -------------------- | ------------------------- | ----------- | ------ | ------------------- |
| PWA + Capacitor     | Natif                | Bibliothèque web directe  | Moyen       | Faible | Retenu              |
| Expo / React Native | Via React Native Web | Version native à intégrer | Bon         | Moyen  | Plus tard si besoin |
| Flutter             | Possible             | Écosystème plus pauvre    | Bon         | Moyen  | Écarté              |
| Kotlin natif        | Aucun                | Natif                     | Très bon    | Élevé  | Écarté au départ    |

**Reste de la pile :**

- **Front :** Angular (application monopage, sans rendu serveur) avec MapLibre GL JS, stockage local IndexedDB (ou SQLite via Capacitor), internationalisation à l'exécution avec Transloco (ou équivalent), anglais par défaut.
- **Backend :** Node.js avec Fastify, API documentée en OpenAPI (générée depuis les schémas de validation par @fastify/swagger), derrière un reverse proxy (Caddy ou nginx) qui ajoute authentification et limitation de débit.
- **Base de données :** PostgreSQL avec PostGIS pour les parcours, les zones et les signalements.
- **Moteurs :** BRouter pour le routage vélo et trail, GraphHopper pour les boucles.

## Architecture globale

![Architecture: device, server, routing, external sources](diagrams/architecture.svg)

L'application fonctionne seule pour consulter et exporter ; le serveur sert à calculer un itinéraire, partager et signaler.

## Routage

BRouter calcule tous les itinéraires derrière une interface « fournisseur de routage » ; GraphHopper s'y ajoute pour les boucles.

**BRouter** est un programme Java qui lit des fichiers de données (.rd5, carrés de 5° x 5° issus d'OpenStreetMap, régénérés chaque semaine sur brouter.de) et répond à des requêtes HTTP du type `GET /brouter?lonlats=lon,lat|lon,lat&profile=trekking&alternativeidx=0&format=geojson`. Il accepte des zones à éviter (cercles, lignes, polygones), 1 à 3 alternatives et des profils modifiables.

| Mode                        | Identifiants                            | Usage                                                                      |
| --------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Serveur public brouter.de   | Aucun                                   | Développement seulement : serveur de bénévoles, sans garantie              |
| Docker auto-hébergé         | Aucun (à protéger par le reverse proxy) | Production : segments de la France montés en volume, profils personnalisés |
| Application Android BRouter | Sans objet                              | Plus tard : calcul sans réseau sur le téléphone                            |

**Interface « fournisseur de routage » :** une seule fonction du backend reçoit points, profil, zones à éviter et nombre d'alternatives, et renvoie une géométrie avec distance, dénivelé et durée. BRouter est l'implémentation par défaut.

**Boucles :** deux voies, utilisables en parallèle.

- Polygone maison : 3 à 4 points autour du départ, reliés par BRouter, avec une graine pour varier les propositions.
- GraphHopper `round_trip` avec `round_trip.distance` et `seed`, qui demande de désactiver les contraction hierarchies.

**Retouches locales :** ajouter, déplacer ou supprimer un point d'un itinéraire déjà calculé ne recalcule qu'un court tronçon autour du point (au moins 500 m de chaque côté, ou deux fois la distance du point à la route), avec un seul appel de trois points. Le reste de la géométrie, une boucle par exemple, est conservé tel quel. Tout est côté web (`planner/local-edit.ts`), sans changement de l'API : changer de profil ou d'alternatives recalcule tout.

**Suppression d'une étape :** exception à la fenêtre des retouches locales, tout le trajet entre les deux points voisins est remplacé par un itinéraire de l'un à l'autre, pour que le détour fait pour l'étape disparaisse en entier. Si les deux voisins sont au même endroit (la seule étape d'une boucle), l'itinéraire est recalculé en entier.

**Inversion :** le bouton d'inversion retourne toute la liste des points (l'arrivée devient le départ, les étapes sont parcourues dans l'ordre inverse) et recalcule l'itinéraire en entier, car le retour n'est pas l'aller (sens uniques, pentes). Une boucle avec au moins deux étapes est parcourue dans l'autre sens.

**Points sur les voies :** avec les profils Route et Gravel, un point posé sur la carte (clic, menu, dépôt d'un marqueur, étape tirée de la trace) s'aimante sur la voie praticable la plus proche, à 100 m au plus et à 24 px au plus à l'écran ; sinon il est refusé avec un message. Le profil Trail n'est pas aimanté, ni les lieux choisis par la recherche ou « Ma position ». Les voies sont lues dans la tuile de zoom 14 du fond de carte local autour du point (les zooms inférieurs n'ont pas les petites routes), par le lecteur PMTiles de la carte : aucun autre serveur n'est appelé et la copie hors-ligne suffit. Les tuiles ne portent que la classe de la voie, pas son revêtement (voir `docs/map-layers.md`).

**Zone couverte et hors ligne :** le fond de carte est un seul fichier PMTiles (`basemap.pmtiles`, la France entière par défaut : 4,7 Go jusqu'au zoom 14 ; mesuré : Angers-Lyon 680 Mo, Europe 22 Go) servi par un simple serveur de fichiers qui accepte les requêtes par plage d'octets. L'application ne lit que les octets qu'elle affiche : la taille du fichier ne coûte rien à l'utilisateur, et il n'y a pas de serveur de tuiles. Pour le hors ligne, on ne copie pas le fichier : l'utilisateur garde des zones, le couloir de 5 km autour du parcours affiché ou la vue à l'écran. L'application lit toutes les tuiles de la zone et range chaque plage d'octets reçue dans un cache du navigateur propre à la zone ; la carte lit ce cache avant le réseau, et supprimer la zone supprime son cache. La taille est estimée avant le téléchargement (échantillon de tuiles) et une zone de plus de 1 Go est refusée. Quand la carte est centrée hors de l'étendue du fichier, une note le dit au lieu de laisser du gris sans explication.

**Photos aériennes (option) :** une case du sélecteur de couches affiche les photos aériennes de l'IGN (Géoplateforme, France) à la place du terrain, de l'eau et des bâtiments du fond de carte ; routes et noms restent dessinés par-dessus. C'est le seul cas où la carte appelle un serveur extérieur : la case est décochée par défaut, une note dit que l'IGN voit l'adresse IP et la zone regardée, rien sur le parcours n'est envoyé. Les photos ne sont ni mises en cache ni incluses dans le téléchargement hors ligne ; hors ligne la case est désactivée et la carte revient au fond local.

**Revêtement du parcours :** BRouter indique pour chaque tronçon les étiquettes OpenStreetMap de la voie (`highway`, `surface`...). L'API les range en cinq catégories (revêtu, piste cyclable, non revêtu ou rugueux, sentier, inconnu), un caractère par segment de la géométrie, et les renvoie avec le parcours. L'application les garde dans les modifications locales et les parcours enregistrés, les montre en barre sous le profil d'altitude avec la part de chacune, et peut colorer le tracé sur la carte (case « Revêtement du tracé » du sélecteur de couches). Les fichiers importés et les liens partagés n'ont pas ces informations.

**Relief sur la carte :** par défaut, l'ombrage vient des tuiles d'altitude publiques d'Amazon (AWS Terrain Tiles, format Terrarium, sans clé, données stables) lues par un petit protocole de la carte : une tuile gardée hors ligne d'abord, le serveur public sinon. Rien à fabriquer ni à héberger, et la couverture est mondiale. La source s'arrête au zoom 12 (les altitudes sont espacées d'environ 30 m), donc une zone gardée hors ligne couvre tous les zooms. Une note sous la case « Relief » dit que le serveur d'Amazon voit l'adresse IP et la zone regardée ; décocher la case arrête les appels. Les données gardées hors ligne : voir plus bas. L'option locale reste possible (`RELIEF_SOURCE_KIND = 'local'`) : `npm run build-relief` découpe les fichiers Copernicus de `data/relief` en tuiles d'altitude (PNG, encodage terrarium, zooms 6 à 11) rangées dans `data/basemap/relief.pmtiles`, servi comme le fond de carte, pour un déploiement qui veut ses propres données ou aucun appel externe. `scripts/download-relief.sh france` télécharge alors les 133 carrés Copernicus de la France (4,6 Go) et la fabrication prend environ deux heures. Dans les deux cas MapLibre en tire un ombrage dessiné sous l'eau, les routes et les noms, affiché par défaut, que le sélecteur de couches permet de masquer.

**Export FIT :** en plus du GPX, un itinéraire enregistré s'exporte en fichier de parcours FIT (course), construit sur l'appareil par un encodeur du projet : un tour, un enregistrement par point du tracé, un point de parcours par étape. Les heures sont déduites de la durée estimée.

**Recalcul pendant le glisser :** tant qu'un point (ou la trace, pour en tirer une étape) est glissé sur la carte, le tracé suit le pointeur. Chaque position est une retouche locale du tracé d'avant le glisser, envoyée au plus toutes les 600 ms et jamais avant la réponse précédente (soit 100 appels par minute au plus, sous la limite de 120 de `POST /route`). `Échap` pendant le glisser remet le point et le tracé en place ; une fois le point déposé, le glisser compte pour une seule étape d'annulation.

**Annuler et rétablir :** le store web garde les 20 derniers états (points, profil, alternatives, mode de boucle, et le tracé affiché à ce moment-là). `Ctrl+Z` et deux boutons du panneau reviennent à l'état précédent sans aucun appel à l'API ; `Ctrl+Maj+Z` ou `Ctrl+Y` le rétablissent. Ouvrir un parcours enregistré ou importer un GPX repart d'un historique vide.

**Alternatives :** OpenRouteService (clé d'API et quotas) et Valhalla (profils vélo moins fins) restent des plans de repli. GraphHopper peut aussi tourner sur Android si le calcul sur appareil devient un objectif.

## Données

OpenStreetMap fournit le réseau, Copernicus ou l'IGN le relief, et des extraits PMTiles le fond de carte.

| Besoin                    | Source                             | Statut                              | Remarque                                                                                                                                                             |
| ------------------------- | ---------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réseau routier et chemins | OpenStreetMap                      | Ouvert (ODbL)                       | Tags utiles : surface, highway, tracktype, smoothness, cycleway, bicycle, construction                                                                               |
| Relief mondial            | Copernicus GLO-30 (30 m)           | Gratuit, licence Copernicus         | Mention de la source obligatoire                                                                                                                                     |
| Relief France             | IGN RGE ALTI (5 m)                 | Ouvert (Licence ouverte Etalab 2.0) | Plus précis que GLO-30                                                                                                                                               |
| Fond de carte hors-ligne  | Extraits PMTiles (Protomaps)       | Ouvert                              | Un fichier par région, lu par MapLibre                                                                                                                               |
| Fond vélo                 | CyclOSM                            | Ouvert                              | Utile en superposition                                                                                                                                               |
| Géocodage                 | Photon                             | Ouvert                              | Appelé par l'API seulement (`GET /geocode`, interface `Geocoder`), jamais par le navigateur. Serveur public à remplacer par une instance propre si le trafic grossit |
| Preuves visuelles         | Mapillary                          | CC-BY-SA                            | Photos de rue pour vérifier un état de route                                                                                                                         |
| Événements routiers       | Bison Futé, transport.data.gouv.fr | Gratuit, accès parfois restreint    | Réseau national non concédé seulement, pas les petites routes                                                                                                        |
| Météo                     | Météo-France (AROME)               | Ouvert                              | Alertes éventuelles                                                                                                                                                  |

Il n'existe pas, à ma connaissance, de jeu de données national fiable sur les travaux des petites routes : la couche de signalements de l'application est la vraie source pour ce besoin. Certaines métropoles et départements publient leurs chantiers sur data.gouv.fr, à chercher zone par zone.

## Local d'abord et hors-ligne

Chaque parcours est enregistré sur l'appareil ; l'envoi au serveur n'a lieu que si l'utilisateur choisit de synchroniser ou de partager.

- **Parcours locaux :** trace, profil d'altitude, métadonnées, aperçu pour la miniature et GPX sont stockés dans IndexedDB ou SQLite (Capacitor). Rouvrir un parcours ne demande ni calcul ni réseau.
- **Fond de carte :** l'utilisateur télécharge un extrait régional PMTiles. Le style de carte, les polices et les icônes sont embarqués.
- **Signalements :** créés hors-ligne, ils sont placés dans une file et envoyés au retour du réseau.
- **Visibilité par parcours :** local seulement (par défaut), privé synchronisé (visible de son seul auteur, sur tous ses appareils), lien partagé, ou public. Quitter l'état « local » copie le parcours sur le serveur ; y revenir le retire du serveur.
- **Export :** le GPX est généré sur l'appareil, puis envoyé vers le Garmin par le plugin de partage de Capacitor.

**Limite connue :** recalculer un itinéraire sans réseau exige un moteur et ses données sur le téléphone. Au départ, hors-ligne signifie consulter, sauvegarder, exporter et dessiner à la main. Le calcul sur appareil est une phase ultérieure (BRouter Android ou GraphHopper embarqué).

**Retrouver un parcours sur un autre appareil :** trois voies, au choix de l'utilisateur.

1. **Synchronisation :** avec un compte (connexion OSM), les parcours « privé synchronisé » apparaissent sur tous ses appareils. Si un parcours est modifié des deux côtés, la version la plus récente l'emporte.
2. **Lien ou QR code :** l'ordinateur affiche un code que le téléphone scanne, sans compte.
3. **Fichier :** export GPX depuis l'ordinateur, puis import dans l'application (fait en phase 1 : trace `<trk>` ou itinéraire `<rte>`, lus sur l'appareil ; sans altitude, le dénivelé peut être calculé à la demande par `POST /elevation`).

## Signalements et zones à éviter

Un tronçon problématique est traité à trois niveaux selon sa durée de vie : immédiat chez l'utilisateur, temporaire pour la communauté, durable dans OpenStreetMap.

**Ordre de réalisation :** en phase 3, seules les zones personnelles et les notes OSM existent. La couche communautaire (partage, confirmation, modération) arrive en phase 4.

| Cas                                                     | Où ça va                                          | Durée de vie                    |
| ------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| Éviter ce tronçon maintenant                            | Zone locale de l'utilisateur, transmise à BRouter | Tant que l'utilisateur la garde |
| Travaux ou fermeture temporaire                         | Couche communautaire de l'application             | Date d'expiration obligatoire   |
| Chemin non roulable, route fermée durablement           | Couche communautaire, sans expiration             | Jusqu'à correction dans OSM     |
| Donnée fausse dans la carte (surface, existence, accès) | Note OSM, ou correction guidée                    | Permanent, profite à tous       |

**Fonctionnement dans l'application :** l'utilisateur sélectionne un tronçon sur une trace enregistrée, choisit un type (travaux, chemin, dangereux, autre) et un commentaire. Si le problème est durable, l'application propose d'envoyer aussi une note à OpenStreetMap.

**Vers OSM :**

1. **Notes :** `POST /api/0.6/notes` avec la position et le texte, droit `write_notes`. Relues par des humains, donc peu risquées. Prévoir la gestion de l'erreur liée aux zones de modération, ajoutée en mai 2026.
2. **Corrections directes :** OAuth 2 obligatoire, les modifications anonymes ne sont plus autorisées. Réserver à un formulaire guidé (surface, état, fermeture) pour les personnes ayant constaté l'erreur sur place.
3. **Mapillary :** photos comme preuve, pour les cas douteux.

**Délai à connaître :** une correction OSM n'atteint le routage qu'à la mise à jour des données (hebdomadaire pour BRouter). Les travaux de quelques jours ne sont en général pas cartographiés dans OSM : c'est la couche de l'application qui les gère.

**Règles de confiance :** un signalement n'est appliqué à tous qu'après confirmation par plusieurs utilisateurs ; les signalements personnels s'appliquent immédiatement à leur auteur.

**Modération au lancement :** vous êtes le seul modérateur et pouvez retirer tout signalement par une commande en ligne ou un accès direct à la base : pas d'interface d'administration au départ. Elle ne sera construite que si la communauté grossit. Un signalement devient communautaire après confirmation par 2 utilisateurs distincts (seuil réglable). Un bouton « signaler un abus » est présent sur chaque zone, et les travaux expirent automatiquement.

## Modèle de données

Quatre entités suffisent au départ ; la même structure existe en local (IndexedDB ou SQLite) et sur le serveur (PostGIS).

| Entité        | Champs principaux                                                                                                                                                                                                    | Remarque                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Parcours      | id court, nom, propriétaire, visibilité (local, privé synchronisé, lien, public), profil, points de passage, géométrie, distance, dénivelé positif, aperçu (trace simplifiée pour la miniature), créé le, modifié le | Le GPX est généré à la demande depuis la géométrie                 |
| Zone à éviter | id, géométrie (cercle, ligne ou polygone), type, portée (personnelle, communautaire), auteur, créée le, expire le                                                                                                    | `expire le` vide pour les chemins non roulables                    |
| Signalement   | id, tronçon ou position, type, commentaire, photo éventuelle, auteur, confirmations, envoyé à OSM (note id)                                                                                                          | Alimente les zones communautaires                                  |
| Utilisateur   | id, nom affiché, connexion OSM optionnelle                                                                                                                                                                           | Le compte n'est requis que pour synchroniser, partager ou signaler |

**Identifiants courts :** 8 à 10 caractères aléatoires, utilisables dans l'adresse de partage (`/p/abc123xy`).

## API backend

L'API est petite : elle calcule, enregistre, partage et signale. Les endpoints ci-dessous sont une proposition de départ.

| Méthode et chemin             | Rôle                                                                                                                                                                | Authentification                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `POST /route`                 | Calcule un itinéraire (points, profil, zones à éviter, alternatives) via le fournisseur de routage                                                                  | Non, avec limitation de débit                          |
| `POST /loops`                 | Propose des boucles (point de départ, distance, dénivelé, graine)                                                                                                   | Non, avec limitation de débit                          |
| `GET /p/{id}`                 | Lit un parcours partagé                                                                                                                                             | Non pour lien ou public                                |
| `PUT /p/{id}`                 | Crée un parcours partagé sous l'identifiant tiré sur l'appareil (jamais mis à jour : un identifiant existant répond 409) ; renvoie une fois un jeton de suppression | Non, avec limitation de débit stricte                  |
| `DELETE /p/{id}`              | Supprime un parcours partagé                                                                                                                                        | Jeton de suppression (en-tête `Authorization: Bearer`) |
| `POST /elevation`             | Altitude de jusqu'à 5000 points, lue localement dans les dalles Copernicus GLO-30                                                                                   | Non, avec limitation de débit                          |
| `GET /p/{id}.gpx`             | Exporte le GPX                                                                                                                                                      | Idem lecture                                           |
| `GET /avoid?bbox=`            | Zones à éviter communautaires dans une emprise                                                                                                                      | Non                                                    |
| `POST /reports`               | Crée un signalement                                                                                                                                                 | Oui                                                    |
| `POST /reports/{id}/confirm`  | Confirme un signalement                                                                                                                                             | Oui                                                    |
| `POST /reports/{id}/osm-note` | Envoie le signalement comme note OSM                                                                                                                                | Oui, via OAuth 2 OSM                                   |

**État de la phase 1 (écart avec la proposition) :** le partage de la phase 1 se fait sans compte : parcours immuables, jeton de suppression dont seul l'empreinte SHA-256 est stockée, ouverture dans l'application sur `/p/:id`. `PUT /p/{id}` ne met donc pas à jour (la synchronisation de la phase 2 reste à concevoir) et le QR code n'est pas encore fait. `POST /loops` et les endpoints de signalement ne sont pas implémentés.

**Protections :** limitation de débit par adresse sur `/route` et `/loops`, taille maximale des requêtes, et mise en cache des itinéraires identiques. Les appels à BRouter passent par une file d'attente dans l'API (`BROUTER_MAX_CONCURRENT`) : au-delà de son nombre de fils, BRouter interrompt un calcul en cours.

**Documentation :** la spécification OpenAPI est générée depuis les schémas de validation de Fastify et publiée par le serveur (fichier de spécification et interface de consultation). Le client TypeScript d'Angular en est généré, pour que le front et l'API ne divergent pas.

**Synchronisation :** `GET /me/routes?since=` renvoie les parcours de l'utilisateur modifiés depuis une date, et `PUT /p/{id}` envoie un parcours créé ou modifié. L'application garde la date de dernière synchronisation.

## Écrans principaux

Cinq écrans couvrent le parcours d'usage, de la préparation à l'export.

1. **Planificateur :** carte, clic pour ajouter départ, arrivée et étapes, choix du profil (route, gravel, trail), alternatives, profil d'altitude, glisser la trace pour la modifier.
2. **Proposer un parcours :** point de départ, boucle ou A vers B, distance et dénivelé cibles, plusieurs propositions à comparer.
3. **Mes parcours :** liste locale avec une miniature de la trace, état (local, synchronisé, partagé), ouverture hors-ligne, export GPX, partage par lien.
4. **Zones et signalements :** sélection d'un tronçon sur une trace, type de problème, envoi à la communauté et à OpenStreetMap.
5. **Cartes hors-ligne :** liste des régions téléchargées, taille, mise à jour.

## Feuille de route

![Roadmap: 5 phases](diagrams/roadmap.svg)

Le socle rend l'application utilisable avant toute fonction communautaire.

| Phase | Nom           | Contenu                                                                                        |
| ----- | ------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Socle         | Carte et routage, profils et GPX, sauvegarde locale, partage par lien, consultation hors-ligne |
| 2     | Planification | Alternatives, édition à la main, boucles, distance cible, dénivelé cible                       |
| 3     | Signalements  | Zones à éviter personnelles, notes OSM, expiration                                             |
| 4     | Communauté    | Parcours publics, évaluations, zones partagées, découverte                                     |
| 5     | Plus tard     | Calcul local, navigation guidée, Expo ou natif si besoin                                       |

Chaque phase laisse une application utilisable ; les dates restent à fixer selon votre temps disponible.

**Avant la phase 1 :** test technique de BRouter sans l'appareil Garmin (itinéraire à vélo de route, zone à éviter, alternatives, GPX vérifié dans un lecteur). Le contrôle sur le Garmin viendra ensuite.

## Licences, coûts et risques

Le code sera en AGPL ; le coût de départ se limite à un petit serveur, et les risques viennent surtout des services publics gratuits.

**Licences**

- **Code :** AGPL, pour que les versions dérivées restent ouvertes.
- **Données OSM :** ODbL. Les parcours partagés publiquement devraient suivre une licence compatible (par exemple CC BY-SA).
- **Relief :** Copernicus impose de citer la source ; l'IGN (Licence ouverte Etalab 2.0) l'exige aussi.
- **Mapillary :** CC-BY-SA, attribution requise.

**Risques et mesures**

| Risque                                                               | Mesure                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Serveur public BRouter, tuiles ou géocodage indisponibles ou limités | Auto-héberger BRouter dès le partage, instance Photon propre, tuiles PMTiles stockées chez soi |
| Abus de l'API de calcul                                              | Limitation de débit, mise en cache, reverse proxy                                              |
| Faux signalements ou vandalisme                                      | Confirmation par plusieurs utilisateurs, expiration, possibilité de retirer un signalement     |
| Corrections OSM de mauvaise qualité                                  | Notes par défaut, correction directe réservée à un formulaire guidé                            |
| Données personnelles de localisation                                 | Local d'abord, partage volontaire, suppression possible à tout moment                          |

**Coûts :** un petit VPS (environ 4 à 6 € par mois en novembre 2026 pour 2 processeurs et 4 Go de mémoire, tarifs à vérifier avant de commander) suffit pour BRouter avec les segments de la France et pour le backend. Le trafic des tuiles et du géocodage est le poste qui grossirait en premier.

**Hébergement :** un VPS européen, avec Docker Compose (BRouter, API, PostgreSQL) et Caddy en reverse proxy. Les données restent dans l'Union européenne et le serveur est disponible en permanence, ce qu'une machine à la maison ne garantit pas. La taille de la machine se décide après le test technique : la mémoire doit suffire à garder les segments de routage en cache.

**Points ouverts :** vérifier la disponibilité du nom Voie Libre (domaine, dépôt de code, boutiques d'applications, marque).
