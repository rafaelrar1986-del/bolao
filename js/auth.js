// js/auth.js
(function(API, UI){
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const userInfo = document.getElementById('user-info');
  const adminTab = document.getElementById('admin-tab');

  async function verifyToken(){
    const token = API.getToken();
    if(!token) return false;
    try{
      const res = await API.request('/api/auth/me', {auth:true});
      window.CURRENT_USER = res.user;
      setLoggedUI(res.user);
      return true;
    }catch(e){
      API.setToken(null);
      return false;
    }
  }

  function setLoggedUI(user){
    loginSection.style.display = 'none';
    appSection.style.display = 'block';
    const isAdmin = !!user.isAdmin;
    userInfo.innerHTML = `Olá, ${user.name}! ${isAdmin ? '<span class="badge"><i class="fas fa-crown"></i> ADMIN</span>':''}`;
    adminTab.style.display = isAdmin ? 'inline-block' : 'none';
  }

  function setupAuthForms(){
    document.getElementById('login-form').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try{
        const res = await API.request('/api/auth/login', {method:'POST', body:{email,password}});
        API.setToken(res.token);
        window.CURRENT_USER = res.user;
        setLoggedUI(res.user);
        window.App.afterLogin();
      }catch(err){
        UI.showMessage('login-section','error', err.message);
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      try{
        await API.request('/api/auth/register', {method:'POST', body:{name,email,password}});
        UI.showMessage('login-section', 'success', 'Conta criada! Faça login.');
        e.target.reset();
      }catch(err){
        UI.showMessage('login-section', 'error', err.message);
      }
    });
  }

  window.Auth = { verifyToken, setupAuthForms };
})(window.API, window.UI);
