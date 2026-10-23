// Curated, local-only media. Administrators choose a key instead of supplying
// uploads or arbitrary URLs; attribution remains controlled by the project.
export const roomImages = Object.freeze([
  Object.freeze({
    key: "auditorio-sbs",
    label: "Auditório de São Bento do Sul - foto Univille (2023)",
    path: "/venues/auditorio-sbs.webp",
    alt: "Auditório do campus São Bento do Sul durante um aulão em 2023",
    kind: "photo",
    credit: "Foto: Univille (2023)",
    sourceUrl:
      "https://www.univille.edu.br/noticias/2023.10/aulao-enem-univille-sao-bento-do-sul/887777",
  }),
  Object.freeze({
    key: "miniauditorio-ilustrativo",
    label: "Miniauditório - imagem ilustrativa",
    path: "/venues/miniauditorio-ilustrativo.webp",
    alt: "Ilustração de um miniauditório; não representa uma fotografia do campus",
    kind: "illustration",
    credit: "Imagem ilustrativa gerada por IA",
    sourceUrl: "",
  }),
  Object.freeze({
    key: "sala-ilustrativa",
    label: "Sala de eventos - imagem ilustrativa",
    path: "/venues/sala-ilustrativa.webp",
    alt: "Ilustração de uma sala de eventos; não representa uma fotografia do campus",
    kind: "illustration",
    credit: "Imagem ilustrativa gerada por IA",
    sourceUrl: "",
  }),
]);

const imageKeys = new Set(roomImages.map((image) => image.key));

export function isRoomImageKey(value) {
  return typeof value === "string" && (value === "" || imageKeys.has(value));
}
