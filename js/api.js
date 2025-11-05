// js/api.js
(function(){
  const BASE = window.APP_CONFIG.API_BASE_URL;
  let token = localStorage.getItem('token') || null;

  function setToken(t){ token = t; if(t) localStorage.setItem('token', t); else localStorage.removeItem('token'); }
  function getToken(){ return token; }

  async function request(path, {method='GET', body=null, auth=false}={}){
    const headers = {'Content-Type':'application/json'};
    if(auth && token){ headers['Authorization'] = `Bearer ${token}`; }
    const res = await fetch(`${BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body): null
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.message || `Erro ${res.status}`);
    return data;
  }

  window.API = { request, setToken, getToken };
})();
