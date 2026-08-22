/*
=========================================================
NEYO — AUTH CONTROLLER
FULL MODULAR RUNTIME

FILE:
public/js/components/auth.js

OWNS
---------------------------------------------------------
✅ Session restore
✅ Current authenticated user
✅ /api/auth session verification
✅ Logout
✅ Authentication state
✅ Auth → Profile bridge
✅ Auth → Plan bridge
✅ Unauthenticated redirect
✅ Session refresh
✅ Auth lifecycle events
✅ Public auth API

DOES NOT OWN
---------------------------------------------------------
❌ Login form
❌ Signup form
❌ Password handling
❌ Bean ID creation
❌ Profile editor UI
❌ Avatar upload
❌ Billing/subscriptions
❌ Chat transport
❌ Settings UI

AUTH ARCHITECTURE
---------------------------------------------------------
Browser
   ↓ HttpOnly Cookie
/api/auth
   ↓
auth.js
   ↓
profile.js / chat / UI
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-auth-modular-v1";


  if (
    window.NeyoAuth
      ?.__controller === true
  ) {
    return;
  }


  /* =====================================================
     LEGACY OWNERSHIP GATE
     ===================================================== */

  const legacyOwnerActive =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );


  const active =
    !legacyOwnerActive;


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      endpoint:
        "/api/auth",

      requestTimeoutMs:
        15_000,

      loginUrl:
        (
          window.NEYO_LOGIN_URL ||
          document.body
            ?.dataset
            ?.loginUrl ||
          "/signup.html?mode=login"
        ),

      proPlans:
        new Set([
          "pro",
          "neyo_pro",
          "neyo-pro",
          "neo_pro",
          "neo-pro",
          "premium",
          "business",
          "team",
          "enterprise",
          "suite"
        ])
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    initialized:
      false,

    checking:
      false,

    loggingOut:
      false,

    authenticated:
      false,

    user:
      null,

    plan:
      "free",

    lastCheckedAt:
      0,

    error:
      null
  };


  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {

    window.dispatchEvent(
      new CustomEvent(
        name,
        {
          detail
        }
      )
    );
  }


  /* =====================================================
     TIMEOUT
     ===================================================== */

  function createTimeoutSignal(
    timeoutMs =
      CONFIG.requestTimeoutMs
  ) {

    const controller =
      new AbortController();


    const timeout =
      window.setTimeout(
        () => {

          controller.abort();
        },
        timeoutMs
      );


    return {

      signal:
        controller.signal,


      clear() {

        window.clearTimeout(
          timeout
        );
      }
    };
  }


  /* =====================================================
     JSON RESPONSE
     ===================================================== */

  async function readJson(
    response
  ) {

    const raw =
      await response
        .text()
        .catch(
          () => ""
        );


    if (!raw) {
      return {};
    }


    try {

      return JSON.parse(
        raw
      );

    } catch {

      return {};
    }
  }


  /* =====================================================
     USER NORMALIZATION
     ===================================================== */

  function cleanUsername(
    value
  ) {

    let username =
      String(
        value || ""
      )
        .trim();


    username =
      username.replace(
        /^@/,
        ""
      );


    username =
      username.replace(
        /@bean$/i,
        ""
      );


    return username
      .slice(
        0,
        100
      );
  }


  function displayBeanId(
    value
  ) {

    const username =
      cleanUsername(
        value
      );


    return username
      ? `@${username}`
      : "@user";
  }


  function normalizePlan(
    value
  ) {

    const plan =
      String(
        value ||
        "free"
      )
        .trim()
        .toLowerCase();


    return CONFIG.proPlans
      .has(
        plan
      )
        ? "pro"
        : "free";
  }


  function normalizeUser(
    user
  ) {

    if (
      !user ||
      typeof user !==
        "object"
    ) {
      return null;
    }


    const username =
      cleanUsername(
        user.username ||
        user.beanId ||
        user.bean_id
      );


    const rawPlan =
      user.planType ||
      user.plan_type ||
      user.plan ||
      "free";


    return {

      id:
        user.id != null
          ? String(
              user.id
            )
          : "",


      username,


      beanId:
        displayBeanId(
          username
        ),


      displayName:
        String(
          user.displayName ||
          user.display_name ||
          user.name ||
          username ||
          "User"
        )
          .trim()
          .slice(
            0,
            100
          ),


      avatar:
        typeof user.avatar_url ===
          "string"
          ? user.avatar_url
          : (
              typeof user.avatar ===
                "string"
                ? user.avatar
                : null
            ),


      rawPlan:
        String(
          rawPlan ||
          "free"
        ),


      plan:
        normalizePlan(
          rawPlan
        )
    };
  }


  /* =====================================================
     PROFILE BRIDGE
     ===================================================== */

  function emitProfile() {

    if (
      !state.authenticated ||
      !state.user
    ) {
      return;
    }


    const profile = {

      id:
        state.user.id,

      username:
        state.user.username,

      beanId:
        state.user.beanId,

      displayName:
        state.user.displayName,

      avatar:
        state.user.avatar,

      plan:
        state.plan ===
        "pro"
          ? "Pro Plan"
          : "Free Plan"
    };


    emit(
      "neyo:auth-profile",
      {
        profile
      }
    );


    emit(
      "neyo:account-plan-change",
      {
        plan:
          profile.plan,

        rawPlan:
          state.user.rawPlan,

        normalized:
          state.plan
      }
    );


    try {

      window.NeyoProfile
        ?.setAuthProfile
        ?.(
          profile
        );

    } catch {}
  }


  /* =====================================================
     SET AUTHENTICATED
     ===================================================== */

  function setAuthenticated(
    user
  ) {

    const normalized =
      normalizeUser(
        user
      );


    if (!normalized) {

      return setUnauthenticated();
    }


    state.authenticated =
      true;


    state.user =
      normalized;


    state.plan =
      normalized.plan;


    state.error =
      null;


    state.lastCheckedAt =
      Date.now();


    document.documentElement
      .classList
      .add(
        "neyo-authenticated"
      );


    document.documentElement
      .classList
      .remove(
        "neyo-unauthenticated"
      );


    if (
      document.body
    ) {

      document.body.dataset
        .authState =
        "authenticated";


      document.body.dataset
        .userPlan =
        state.plan;
    }


    emitProfile();


    emit(
      "neyo:auth-change",
      {
        authenticated:
          true,

        user: {
          ...state.user
        },

        plan:
          state.plan
      }
    );


    emit(
      "neyo:auth-authenticated",
      {
        user: {
          ...state.user
        },

        plan:
          state.plan
      }
    );


    return true;
  }


  /* =====================================================
     SET UNAUTHENTICATED
     ===================================================== */

  function setUnauthenticated(
    reason =
      "unauthenticated"
  ) {

    state.authenticated =
      false;


    state.user =
      null;


    state.plan =
      "free";


    state.lastCheckedAt =
      Date.now();


    document.documentElement
      .classList
      .remove(
        "neyo-authenticated"
      );


    document.documentElement
      .classList
      .add(
        "neyo-unauthenticated"
      );


    if (
      document.body
    ) {

      document.body.dataset
        .authState =
        "unauthenticated";


      document.body.dataset
        .userPlan =
        "free";
    }


    emit(
      "neyo:auth-change",
      {
        authenticated:
          false,

        user:
          null,

        plan:
          "free",

        reason
      }
    );


    emit(
      "neyo:auth-unauthenticated",
      {
        reason
      }
    );


    return false;
  }


  /* =====================================================
     SESSION REQUEST
     ===================================================== */

  async function requestSession() {

    const timeout =
      createTimeoutSignal();


    try {

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method:
              "GET",

            credentials:
              "include",

            cache:
              "no-store",

            redirect:
              "error",

            signal:
              timeout.signal,

            headers: {
              Accept:
                "application/json",

              "X-Neyo-Client":
                VERSION
            }
          }
        );


      const data =
        await readJson(
          response
        );


      /*
       * Both current backend behaviors are tolerated:
       *
       * 401 + authenticated:false
       * OR
       * 200 + authenticated:false
       */

      if (
        response.status ===
          401 ||
        data?.authenticated ===
          false
      ) {

        return {
          authenticated:
            false,

          user:
            null,

          status:
            response.status
        };
      }


      if (
        !response.ok
      ) {

        const error =
          new Error(
            data?.error ||
            `Authentication check failed (${response.status}).`
          );


        error.status =
          response.status;


        throw error;
      }


      if (
        data?.authenticated !==
          true ||
        !data?.user
      ) {

        return {
          authenticated:
            false,

          user:
            null,

          status:
            response.status
        };
      }


      return {

        authenticated:
          true,

        user:
          data.user,

        status:
          response.status
      };

    } catch (
      error
    ) {

      if (
        error?.name ===
        "AbortError"
      ) {

        const timeoutError =
          new Error(
            "Authentication check timed out."
          );


        timeoutError.code =
          "AUTH_TIMEOUT";


        throw timeoutError;
      }


      throw error;

    } finally {

      timeout.clear();
    }
  }


  /* =====================================================
     RESTORE SESSION
     ===================================================== */

  async function restoreSession({
    redirectIfMissing =
      true
  } = {}) {

    if (
      !active ||
      state.checking
    ) {

      return state.authenticated;
    }


    state.checking =
      true;


    state.error =
      null;


    if (
      document.body
    ) {

      document.body.dataset
        .authState =
        "checking";
    }


    emit(
      "neyo:auth-check-start"
    );


    try {

      const result =
        await requestSession();


      if (
        !result.authenticated
      ) {

        setUnauthenticated(
          "session-missing"
        );


        emit(
          "neyo:auth-check-end",
          {
            authenticated:
              false
          }
        );


        if (
          redirectIfMissing
        ) {

          redirectToLogin();
        }


        return false;
      }


      setAuthenticated(
        result.user
      );


      emit(
        "neyo:auth-check-end",
        {
          authenticated:
            true,

          user: {
            ...state.user
          }
        }
      );


      return true;

    } catch (
      error
    ) {

      state.error =
        error;


      /*
       * Important:
       * Network/server failure != confirmed logout.
       *
       * Do not destroy the current session or redirect
       * just because /api/auth temporarily returned 500
       * or the network dropped.
       */

      console.warn(
        "[NEYO Auth] Session verification failed:",
        error?.message
      );


      emit(
        "neyo:auth-error",
        {
          phase:
            "restore",

          message:
            error?.message ||
            "Unable to verify session.",

          status:
            error?.status ||
            null
        }
      );


      emit(
        "neyo:auth-check-end",
        {
          authenticated:
            state.authenticated,

          error:
            true
        }
      );


      return state.authenticated;

    } finally {

      state.checking =
        false;
    }
  }


  /* =====================================================
     REFRESH
     ===================================================== */

  async function refresh() {

    return restoreSession({
      redirectIfMissing:
        false
    });
  }


  /* =====================================================
     REDIRECT
     ===================================================== */

  function redirectToLogin() {

    const url =
      String(
        CONFIG.loginUrl ||
        "/signup.html?mode=login"
      );


    emit(
      "neyo:auth-redirect",
      {
        url
      }
    );


    window.location.replace(
      url
    );
  }


  /* =====================================================
     LOGOUT API
     ===================================================== */

  async function requestLogout() {

    const timeout =
      createTimeoutSignal();


    try {

      const response =
        await fetch(
          CONFIG.endpoint,
          {
            method:
              "POST",

            credentials:
              "include",

            cache:
              "no-store",

            redirect:
              "error",

            signal:
              timeout.signal,

            headers: {
              Accept:
                "application/json",

              "Content-Type":
                "application/json",

              "X-Neyo-Client":
                VERSION
            },

            body:
              JSON.stringify({
                action:
                  "logout"
              })
          }
        );


      const data =
        await readJson(
          response
        );


      if (
        !response.ok
      ) {

        const error =
          new Error(
            data?.error ||
            `Logout failed (${response.status}).`
          );


        error.status =
          response.status;


        throw error;
      }


      return data;

    } catch (
      error
    ) {

      if (
        error?.name ===
        "AbortError"
      ) {

        const timeoutError =
          new Error(
            "Logout request timed out."
          );


        timeoutError.code =
          "LOGOUT_TIMEOUT";


        throw timeoutError;
      }


      throw error;

    } finally {

      timeout.clear();
    }
  }


  /* =====================================================
     LOCAL SESSION-SCOPED CLEANUP

     Do NOT wipe user preferences.
     Theme/settings/profile preferences can survive logout.

     Only volatile/session-specific state is removed.
     ===================================================== */

  function clearLocalSessionState() {

    const keys = [

      "neo_user_memories",
      "neyo_current_conversation",
      "neyo_current_chat_id",
      "neyo_session_user"
    ];


    for (
      const key
      of keys
    ) {

      try {

        localStorage.removeItem(
          key
        );

      } catch {}
    }


    try {

      sessionStorage.clear();

    } catch {}
  }


  /* =====================================================
     LOGOUT
     ===================================================== */

  async function logout({
    redirect =
      true
  } = {}) {

    if (
      !active ||
      state.loggingOut
    ) {
      return false;
    }


    state.loggingOut =
      true;


    emit(
      "neyo:auth-logout-start"
    );


    try {

      /*
       * Server clears the HttpOnly cookie.
       */

      await requestLogout();


      emit(
        "neyo:auth-logout-server-complete"
      );

    } catch (
      error
    ) {

      /*
       * We still redirect to login.
       *
       * If the server request failed because of network,
       * the login/session check will determine real state.
       */

      console.warn(
        "[NEYO Auth] Logout request failed:",
        error?.message
      );


      emit(
        "neyo:auth-error",
        {
          phase:
            "logout",

          message:
            error?.message ||
            "Logout request failed.",

          status:
            error?.status ||
            null
        }
      );

    } finally {

      clearLocalSessionState();


      setUnauthenticated(
        "logout"
      );


      state.loggingOut =
        false;


      emit(
        "neyo:auth-logout"
      );


      if (redirect) {

        redirectToLogin();
      }
    }


    return true;
  }


  /* =====================================================
     AUTH REQUIRED RESPONSE

     Other modules can emit this after receiving 401.
     ===================================================== */

  function handleAuthenticationRequired() {

    setUnauthenticated(
      "authentication-required"
    );


    redirectToLogin();
  }


  /* =====================================================
     VISIBILITY REFRESH

     Re-check session after returning to a tab if the
     last verification is old enough.
     ===================================================== */

  function handleVisibilityChange() {

    if (
      document.visibilityState !==
      "visible" ||
      state.checking ||
      state.loggingOut
    ) {
      return;
    }


    const age =
      Date.now() -
      state.lastCheckedAt;


    if (
      age <
      5 * 60 * 1000
    ) {
      return;
    }


    void refresh();
  }


  /* =====================================================
     BIND
     ===================================================== */

  function bind() {

    if (!active) {
      return false;
    }


    /*
     * sidebar.js emits this.
     */

    window.addEventListener(
      "neyo:logout-request",
      () => {

        void logout();
      }
    );


    /*
     * Any API-owning module can report confirmed 401.
     */

    window.addEventListener(
      "neyo:auth-required",
      handleAuthenticationRequired
    );


    window.addEventListener(
      "neyo:auth-refresh-request",
      () => {

        void refresh();
      }
    );


    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );


    return true;
  }


  /* =====================================================
     INITIALIZE
     ===================================================== */

  async function initialize() {

    if (
      !active ||
      state.initialized
    ) {

      return state.authenticated;
    }


    state.initialized =
      true;


    bind();


    const authenticated =
      await restoreSession({
        redirectIfMissing:
          true
      });


    emit(
      "neyo:auth-ready",
      {
        version:
          VERSION,

        authenticated,

        user:
          state.user
            ? {
                ...state.user
              }
            : null,

        plan:
          state.plan
      }
    );


    return authenticated;
  }


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({

      __controller:
        true,


      version:
        VERSION,


      active,


      legacyOwnerActive,


      init:
        initialize,


      restoreSession,


      refresh,


      logout,


      redirectToLogin,


      isAuthenticated:
        () =>
          state.authenticated,


      isChecking:
        () =>
          state.checking,


      isLoggingOut:
        () =>
          state.loggingOut,


      isPro:
        () =>
          state.plan ===
          "pro",


      getPlan:
        () =>
          state.plan,


      getUser() {

        return state.user
          ? {
              ...state.user
            }
          : null;
      },


      getUserId() {

        return (
          state.user?.id ||
          ""
        );
      },


      getBeanId() {

        return (
          state.user
            ?.beanId ||
          ""
        );
      },


      requireAuth() {

        if (
          state.authenticated
        ) {
          return true;
        }


        redirectToLogin();


        return false;
      },


      getState() {

        return {

          version:
            VERSION,

          active,

          legacyOwnerActive,

          initialized:
            state.initialized,

          checking:
            state.checking,

          loggingOut:
            state.loggingOut,

          authenticated:
            state.authenticated,

          plan:
            state.plan,

          lastCheckedAt:
            state.lastCheckedAt,

          user:
            state.user
              ? {
                  ...state.user
                }
              : null,

          error:
            state.error
              ? {
                  message:
                    state.error
                      .message,

                  status:
                    state.error
                      .status ||
                    null
                }
              : null
        };
      }
    });


  Object.defineProperty(
    window,
    "NeyoAuth",
    {
      value:
        api,

      writable:
        false,

      configurable:
        true,

      enumerable:
        true
    }
  );


  /* =====================================================
     BOOT

     Run after current module execution.
     ===================================================== */

  if (active) {

    queueMicrotask(
      () => {

        void initialize();
      }
    );
  }


  /* =====================================================
     PASSIVE READY EVENT
     ===================================================== */

  if (!active) {

    emit(
      "neyo:auth-ready",
      {
        version:
          VERSION,

        active:
          false,

        legacyOwnerActive:
          true
      }
    );
  }

})();
