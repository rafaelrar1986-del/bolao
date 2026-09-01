// js/flags.js
// Conversao de pais/codigo -> emoji de bandeira

const NAME_TO_CODE = {
  // AMERICA DO SUL
  "brasil":"BR","brazil":"BR","br":"BR",
  "argentina":"AR","ar":"AR",
  "uruguai":"UY","uruguay":"UY","uy":"UY",
  "paraguai":"PY","paraguay":"PY","py":"PY",
  "equador":"EC","ecuador":"EC","ec":"EC",
  "colombia":"CO","colombia":"CO","co":"CO",
  "chile":"CL","cl":"CL",
  "peru":"PE","pe":"PE",
  "venezuela":"VE","ve":"VE",
  "bolivia":"BO","bolivia":"BO","bo":"BO",

  // EUROPA
  "alemanha":"DE","germany":"DE","de":"DE",
  "espanha":"ES","spain":"ES","es":"ES",
  "franca":"FR","franca":"FR","france":"FR","fr":"FR",

  // CORRECAO UK (SELECOES)
  "inglaterra":"ENG","england":"ENG",
  "escocia":"SCO","escocia":"SCO","scotland":"SCO",
  "pais de gales":"WAL","gales":"WAL","wales":"WAL",

  // Reino Unido continua existindo se precisar
  "reino unido":"GB","united kingdom":"GB","gb":"GB","uk":"GB",

  "italia":"IT","italia":"IT","italy":"IT","it":"IT",
  "portugal":"PT","pt":"PT",
  "holanda":"NL","netherlands":"NL","paises baixos":"NL","nl":"NL",
  "belgica":"BE","belgica":"BE","belgium":"BE","be":"BE",
  "suica":"CH","suica":"CH","switzerland":"CH","ch":"CH",
  "croacia":"HR","croacia":"HR","croatia":"HR","hr":"HR",
  "servia":"RS","servia":"RS","serbia":"RS","rs":"RS",
  "polonia":"PL","polonia":"PL","poland":"PL","pl":"PL",
  "dinamarca":"DK","denmark":"DK","dk":"DK",
  "suecia":"SE","suecia":"SE","sweden":"SE","se":"SE",
  "noruega":"NO","norway":"NO","no":"NO",
  "turquia":"TR","turkey":"TR","tr":"TR",
  "austria":"AT","austria":"AT","at":"AT",
  "grecia":"GR","grecia":"GR","greece":"GR","gr":"GR",
  "ucrania":"UA","ucrania":"UA","ukraine":"UA","ua":"UA",
  "republica tcheca":"CZ","tchequia":"CZ","czech republic":"CZ","cz":"CZ",
  "bosnia":"BA","bosnia e herzegovina":"BA","bosnia and herzegovina":"BA","ba":"BA",
  "russia":"RU","russia":"RU","ru":"RU",

  // AMERICA DO NORTE
  "mexico":"MX","mexico":"MX","mx":"MX",
  "estados unidos":"US","usa":"US","eua":"US","us":"US",
  "canada":"CA","canada":"CA","ca":"CA",
  "costa rica":"CR","cr":"CR",
  "panama":"PA","panama":"PA","pa":"PA",
  "honduras":"HN","hn":"HN",
  "jamaica":"JM","jm":"JM",
  "haiti":"HT","ht":"HT",
  "curacao":"CW","curacao":"CW","cw":"CW",

  // ASIA
  "japao":"JP","japao":"JP","japan":"JP","jp":"JP",
  "coreia do sul":"KR","sul-coreia":"KR","south korea":"KR","kr":"KR",
  "arabia saudita":"SA","arabia saudita":"SA","saudi arabia":"SA","sa":"SA",
  "qatar":"QA","catar":"QA","qa":"QA",
  "australia":"AU","australia":"AU","au":"AU",
  "ira":"IR","ira":"IR","iran":"IR","ir":"IR",
  "iraque":"IQ","iraq":"IQ","iq":"IQ",
  "jordania":"JO","jordania":"JO","jordan":"JO","jo":"JO",
  "uzbequistao":"UZ","uzbequistao":"UZ","uzbekistan":"UZ","uz":"UZ",
  "nova zelandia":"NZ","nova zelandia":"NZ","nz":"NZ",

  // AFRICA
  "mali":"ML","ml":"ML",
  "marrocos":"MA","morocco":"MA","ma":"MA",
  "tunisia":"TN","tunisia":"TN","tn":"TN",
  "egito":"EG","egypt":"EG","eg":"EG",
  "camaroes":"CM","camaroes":"CM","cameroon":"CM","cm":"CM",
  "senegal":"SN","sn":"SN",
  "nigeria":"NG","nigeria":"NG","ng":"NG",
  "gana":"GH","ghana":"GH","gh":"GH",
  "costa do marfim":"CI","ivory coast":"CI","ci":"CI",
  "argelia":"DZ","argelia":"DZ","dz":"DZ",
  "africa do sul":"ZA","south africa":"ZA","za":"ZA",
  "congo":"CG","republica do congo":"CG","cg":"CG",
  "rd congo":"CD","republica democratica do congo":"CD","dr congo":"CD","cd":"CD",
  "cabo verde":"CV","cabo-verde":"CV","cv":"CV"
};

function codeToEmoji(code) {
  if (!code) return '';

  // TRATAMENTO ESPECIAL UK (flags reais das selecoes)
  if (code === "ENG") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
  if (code === "SCO") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
  if (code === "WAL") return "🏴";

  if (code.length !== 2) return '';

  const a = 0x1F1E6;
  const A = 'A'.charCodeAt(0);
  const c1 = a + (code[0].toUpperCase().charCodeAt(0) - A);
  const c2 = a + (code[1].toUpperCase().charCodeAt(0) - A);
  return String.fromCodePoint(c1) + String.fromCodePoint(c2);
}

export function flagEmoji(nameOrCode) {
  if (!nameOrCode) return '';

  const key = String(nameOrCode)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  let code = key.length === 2
    ? key.toUpperCase()
    : (NAME_TO_CODE[key] || '');

  if (!code && /\b[a-z]{2}\b/i.test(key)) {
    const m = key.match(/\b([a-z]{2})\b/i);
    if (m) code = m[1].toUpperCase();
  }

  return codeToEmoji(code);
}
