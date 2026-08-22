/*
=========================================================
NEYO — PROFILE CONTROLLER
FULL MODULAR RUNTIME

FILE:
public/js/components/profile.js

OWNS
---------------------------------------------------------
✅ Profile settings UI
✅ Display name
✅ Sidebar display-name sync
✅ Avatar choose / preview / remove
✅ Safe avatar processing
✅ Profile Save / Reset
✅ Local profile persistence
✅ Bean ID display bridge
✅ Plan badge display bridge
✅ Profile dirty / saving state
✅ Profile settings open sync
✅ Public profile API

DOES NOT OWN
---------------------------------------------------------
❌ Authentication
❌ Bean ID creation/change
❌ Session lifecycle
❌ Logout
❌ Subscription/billing
❌ Settings modal navigation
❌ Remote user database

INTEGRATION
---------------------------------------------------------
auth.js
   ↓
neyo:auth-profile

profile.js
   ↓
sidebar profile UI

settings.js
   ↓
neyo:profile-settings-open-request
   ↓
profile.js
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-profile-modular-v1";


  if (
    window.NeyoProfile
      ?.__controller === true
  ) {
    return;
  }


  /* =====================================================
     DOM
     ===================================================== */

  const settingsAvatarPreview =
    document.getElementById(
      "settingsAvatarPreview"
    );


  const chooseAvatarBtn =
    document.getElementById(
      "chooseAvatarBtn"
    );


  const removeAvatarBtn =
    document.getElementById(
      "removeAvatarBtn"
    );


  const settingsAvatarFileInput =
    document.getElementById(
      "settingsAvatarFileInput"
    );


  const settingsDisplayNameInput =
    document.getElementById(
      "settingsDisplayNameInput"
    );


  const settingsUsernameInput =
    document.getElementById(
      "settingsUsernameInput"
    );


  const saveProfileSettingsBtn =
    document.getElementById(
      "saveProfileSettingsBtn"
    );


  const resetProfileSettingsBtn =
    document.getElementById(
      "resetProfileSettingsBtn"
    );


  const userAvatar =
    document.getElementById(
      "userAvatar"
    );


  const userNameDisplay =
    document.getElementById(
      "userNameDisplay"
    );


  const userPlanBadge =
    document.getElementById(
      "userPlanBadge"
    );


  const profilePanel =
    document.getElementById(
      "settingsPanelProfile"
    );


  if (
    !settingsDisplayNameInput ||
    !settingsAvatarPreview
  ) {

    console.warn(
      "[NEYO Profile] Required profile DOM missing."
    );


    return;
  }


  /* =====================================================
     LEGACY OWNERSHIP
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

      storageKey:
        "neyo_profile_v1",

      legacyNameKey:
        "neyo_profile_name",

      legacyAvatarKey:
        "neyo_profile_avatar",

      maxSourceBytes:
        5 * 1024 * 1024,

      maxAvatarDimension:
        512,

      avatarQuality:
        0.86,

      maxDisplayNameLength:
        60,

      allowedImageTypes:
        [
          "image/jpeg",
          "image/png",
          "image/webp"
        ],

      defaultName:
        "User",

      defaultUsername:
        "@user",

      defaultPlan:
        "Free Plan"
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    profile: {
      displayName:
        CONFIG.defaultName,

      username:
        CONFIG.defaultUsername,

      avatar:
        null,

      plan:
        CONFIG.defaultPlan
    },


    draft: {
      displayName:
        CONFIG.defaultName,

      avatar:
        null
    },


    dirty:
      false,

    saving:
      false,

    processingAvatar:
      false,

    initialized:
      false
  };


  /* =====================================================
     EVENT
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
     UTIL
     ===================================================== */

  function cleanDisplayName(
    value
  ) {

    return String(
      value || ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        ""
      )
      .trim()
      .slice(
        0,
        CONFIG.maxDisplayNameLength
      );
  }


  function normalizeUsername(
    value
  ) {

    let username =
      String(
        value || ""
      )
        .trim();


    if (!username) {

      return CONFIG.defaultUsername;
    }


    if (
      !username.startsWith(
        "@"
      )
    ) {

      username =
        `@${username}`;
    }


    return username
      .slice(
        0,
        100
      );
  }


  function normalizePlan(
    value
  ) {

    const plan =
      String(
        value || ""
      )
        .trim();


    return (
      plan ||
      CONFIG.defaultPlan
    );
  }


  function escapeInitialsSource(
    value
  ) {

    return cleanDisplayName(
      value
    ) ||
    CONFIG.defaultName;
  }


  function getInitials(
    value
  ) {

    const parts =
      escapeInitialsSource(
        value
      )
        .split(/\s+/)
        .filter(Boolean);


    if (!parts.length) {
      return "U";
    }


    if (
      parts.length === 1
    ) {

      return parts[0]
        .slice(0, 2)
        .toUpperCase();
    }


    return (
      parts[0][0] +
      parts[
        parts.length - 1
      ][0]
    ).toUpperCase();
  }


  /* =====================================================
     STORAGE
     ===================================================== */

  function safeRead(
    key
  ) {

    try {

      return localStorage.getItem(
        key
      );

    } catch {

      return null;
    }
  }


  function safeWrite(
    key,
    value
  ) {

    try {

      localStorage.setItem(
        key,
        value
      );


      return true;

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Profile] Could not persist profile:",
        error
      );


      return false;
    }
  }


  function safeRemove(
    key
  ) {

    try {

      localStorage.removeItem(
        key
      );

    } catch {}
  }


  function loadStoredProfile() {

    let stored =
      null;


    try {

      const raw =
        safeRead(
          CONFIG.storageKey
        );


      if (raw) {

        stored =
          JSON.parse(
            raw
          );
      }

    } catch {}


    /*
     * Compatibility with older local profile fields.
     */

    const legacyName =
      safeRead(
        CONFIG.legacyNameKey
      );


    const legacyAvatar =
      safeRead(
        CONFIG.legacyAvatarKey
      );


    return {

      displayName:
        cleanDisplayName(
          stored?.displayName ||
          legacyName ||
          CONFIG.defaultName
        ) ||
        CONFIG.defaultName,


      username:
        normalizeUsername(
          stored?.username ||
          CONFIG.defaultUsername
        ),


      avatar:
        typeof stored?.avatar ===
          "string"
          ? stored.avatar
          : (
              typeof legacyAvatar ===
              "string"
                ? legacyAvatar
                : null
            ),


      plan:
        normalizePlan(
          stored?.plan ||
          CONFIG.defaultPlan
        )
    };
  }


  function persistProfile() {

    const payload = {

      displayName:
        state.profile
          .displayName,

      username:
        state.profile
          .username,

      avatar:
        state.profile
          .avatar,

      plan:
        state.profile
          .plan
    };


    const success =
      safeWrite(
        CONFIG.storageKey,
        JSON.stringify(
          payload
        )
      );


    /*
     * Keep old keys synchronized
     * while migration is in progress.
     */

    if (success) {

      safeWrite(
        CONFIG.legacyNameKey,
        payload.displayName
      );


      if (
        payload.avatar
      ) {

        safeWrite(
          CONFIG.legacyAvatarKey,
          payload.avatar
        );

      } else {

        safeRemove(
          CONFIG.legacyAvatarKey
        );
      }
    }


    return success;
  }


  /* =====================================================
     AVATAR RENDER
     ===================================================== */

  function renderAvatarElement(
    element,
    avatar,
    displayName
  ) {

    if (!element) {
      return;
    }


    /*
     * Remove previous image safely.
     */

    element
      .querySelectorAll(
        "img[data-neyo-profile-avatar]"
      )
      .forEach(
        image =>
          image.remove()
      );


    if (
      avatar &&
      typeof avatar ===
        "string"
    ) {

      const image =
        document.createElement(
          "img"
        );


      image.setAttribute(
        "data-neyo-profile-avatar",
        "true"
      );


      image.alt =
        "";


      image.src =
        avatar;


      image.draggable =
        false;


      image.style.width =
        "100%";


      image.style.height =
        "100%";


      image.style.objectFit =
        "cover";


      image.style.borderRadius =
        "inherit";


      element.textContent =
        "";


      element.appendChild(
        image
      );


      element.classList.add(
        "has-avatar"
      );


      return;
    }


    element.classList.remove(
      "has-avatar"
    );


    element.textContent =
      getInitials(
        displayName
      );
  }


  /* =====================================================
     SIDEBAR PROFILE
     ===================================================== */

  function renderSidebarProfile() {

    const profile =
      state.profile;


    if (
      userNameDisplay
    ) {

      userNameDisplay.textContent =
        profile.displayName;
    }


    if (
      userPlanBadge
    ) {

      userPlanBadge.textContent =
        profile.plan;
    }


    renderAvatarElement(
      userAvatar,
      profile.avatar,
      profile.displayName
    );
  }


  /* =====================================================
     SETTINGS PREVIEW
     ===================================================== */

  function renderDraft() {

    if (
      settingsDisplayNameInput
    ) {

      settingsDisplayNameInput.value =
        state.draft
          .displayName;
    }


    if (
      settingsUsernameInput
    ) {

      settingsUsernameInput.value =
        state.profile
          .username;
    }


    renderAvatarElement(
      settingsAvatarPreview,
      state.draft.avatar,
      state.draft.displayName
    );


    syncDirtyState();
  }


  /* =====================================================
     DIRTY STATE
     ===================================================== */

  function computeDirty() {

    return (
      state.draft.displayName !==
        state.profile.displayName ||

      state.draft.avatar !==
        state.profile.avatar
    );
  }


  function syncDirtyState() {

    state.dirty =
      computeDirty();


    profilePanel
      ?.classList
      .toggle(
        "is-dirty",
        state.dirty
      );


    if (
      saveProfileSettingsBtn
    ) {

      saveProfileSettingsBtn.disabled =
        !state.dirty ||
        state.saving ||
        state.processingAvatar;
    }


    if (
      resetProfileSettingsBtn
    ) {

      resetProfileSettingsBtn.disabled =
        !state.dirty ||
        state.saving;
    }


    return state.dirty;
  }


  /* =====================================================
     BUSY
     ===================================================== */

  function setSaving(
    saving
  ) {

    state.saving =
      Boolean(
        saving
      );


    if (
      saveProfileSettingsBtn
    ) {

      saveProfileSettingsBtn
        .setAttribute(
          "aria-busy",
          String(
            state.saving
          )
        );


      saveProfileSettingsBtn.textContent =
        state.saving
          ? "Saving…"
          : "Save";
    }


    syncDirtyState();
  }


  function setAvatarProcessing(
    processing
  ) {

    state.processingAvatar =
      Boolean(
        processing
      );


    chooseAvatarBtn
      ?.toggleAttribute(
        "disabled",
        state.processingAvatar
      );


    syncDirtyState();
  }


  /* =====================================================
     IMAGE LOADING
     ===================================================== */

  function readFileAsDataURL(
    file
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const reader =
          new FileReader();


        reader.onload =
          () =>
            resolve(
              String(
                reader.result ||
                ""
              )
            );


        reader.onerror =
          () =>
            reject(
              new Error(
                "Could not read image."
              )
            );


        reader.readAsDataURL(
          file
        );
      }
    );
  }


  function loadImage(
    source
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const image =
          new Image();


        image.onload =
          () =>
            resolve(
              image
            );


        image.onerror =
          () =>
            reject(
              new Error(
                "Invalid image."
              )
            );


        image.src =
          source;
      }
    );
  }


  /* =====================================================
     AVATAR PROCESSING

     Source can be up to 5 MB.
     We resize before storing so localStorage
     is not filled with a huge raw photo.
     ===================================================== */

  async function processAvatarFile(
    file
  ) {

    if (
      !(file instanceof File)
    ) {

      throw new Error(
        "Invalid image file."
      );
    }


    if (
      !CONFIG.allowedImageTypes
        .includes(
          file.type
        )
    ) {

      throw new Error(
        "Use PNG, JPG or WebP."
      );
    }


    if (
      file.size >
      CONFIG.maxSourceBytes
    ) {

      throw new Error(
        "Profile photo must be 5 MB or smaller."
      );
    }


    const source =
      await readFileAsDataURL(
        file
      );


    const image =
      await loadImage(
        source
      );


    const longest =
      Math.max(
        image.naturalWidth,
        image.naturalHeight
      );


    const scale =
      longest >
      CONFIG.maxAvatarDimension
        ? CONFIG.maxAvatarDimension /
          longest
        : 1;


    const width =
      Math.max(
        1,
        Math.round(
          image.naturalWidth *
          scale
        )
      );


    const height =
      Math.max(
        1,
        Math.round(
          image.naturalHeight *
          scale
        )
      );


    const canvas =
      document.createElement(
        "canvas"
      );


    canvas.width =
      width;


    canvas.height =
      height;


    const context =
      canvas.getContext(
        "2d",
        {
          alpha:
            true
        }
      );


    if (!context) {

      throw new Error(
        "Image processing unavailable."
      );
    }


    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );


    /*
     * WebP keeps storage significantly smaller.
     * Browser fallback below if WebP encoding fails.
     */

    let output =
      canvas.toDataURL(
        "image/webp",
        CONFIG.avatarQuality
      );


    if (
      !output ||
      output ===
        "data:,"
    ) {

      output =
        canvas.toDataURL(
          "image/jpeg",
          CONFIG.avatarQuality
        );
    }


    return output;
  }


  /* =====================================================
     AVATAR SELECT
     ===================================================== */

  async function handleAvatarFile(
    file
  ) {

    if (!active) {
      return false;
    }


    setAvatarProcessing(
      true
    );


    try {

      const avatar =
        await processAvatarFile(
          file
        );


      state.draft.avatar =
        avatar;


      renderDraft();


      emit(
        "neyo:profile-avatar-preview",
        {
          hasAvatar:
            true
        }
      );


      return true;

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Profile] Avatar rejected:",
        error
      );


      emit(
        "neyo:profile-error",
        {
          code:
            "avatar",

          message:
            error?.message ||
            "Could not use profile photo."
        }
      );


      return false;

    } finally {

      setAvatarProcessing(
        false
      );


      if (
        settingsAvatarFileInput
      ) {

        settingsAvatarFileInput.value =
          "";
      }
    }
  }


  /* =====================================================
     REMOVE AVATAR
     ===================================================== */

  function removeAvatar() {

    if (!active) {
      return false;
    }


    state.draft.avatar =
      null;


    renderDraft();


    emit(
      "neyo:profile-avatar-preview",
      {
        hasAvatar:
          false
      }
    );


    return true;
  }


  /* =====================================================
     VALIDATE
     ===================================================== */

  function validateDraft() {

    const displayName =
      cleanDisplayName(
        settingsDisplayNameInput
          ?.value ||
        state.draft.displayName
      );


    if (!displayName) {

      return {
        valid:
          false,

        message:
          "Display name is required."
      };
    }


    if (
      displayName.length >
      CONFIG.maxDisplayNameLength
    ) {

      return {
        valid:
          false,

        message:
          `Display name must be ${CONFIG.maxDisplayNameLength} characters or less.`
      };
    }


    return {
      valid:
        true,

      displayName
    };
  }


  /* =====================================================
     SAVE
     ===================================================== */

  async function save() {

    if (
      !active ||
      state.saving ||
      state.processingAvatar
    ) {
      return false;
    }


    state.draft.displayName =
      cleanDisplayName(
        settingsDisplayNameInput
          ?.value ||
        state.draft.displayName
      );


    const validation =
      validateDraft();


    if (
      !validation.valid
    ) {

      emit(
        "neyo:profile-error",
        {
          code:
            "validation",

          message:
            validation.message
        }
      );


      settingsDisplayNameInput
        ?.focus
        ?.();


      return false;
    }


    setSaving(
      true
    );


    try {

      state.profile = {

        ...state.profile,

        displayName:
          validation.displayName,

        avatar:
          state.draft.avatar
      };


      const persisted =
        persistProfile();


      renderSidebarProfile();


      state.draft = {

        displayName:
          state.profile
            .displayName,

        avatar:
          state.profile
            .avatar
      };


      renderDraft();


      /*
       * Remote/profile backend modules may listen
       * and sync this data separately.
       */

      emit(
        "neyo:profile-save-request",
        {
          profile: {
            ...state.profile
          }
        }
      );


      emit(
        "neyo:profile-change",
        {
          profile: {
            ...state.profile
          },

          persistedLocally:
            persisted
        }
      );


      return true;

    } finally {

      setSaving(
        false
      );
    }
  }


  /* =====================================================
     RESET UNSAVED CHANGES
     ===================================================== */

  function resetDraft() {

    if (
      !active ||
      state.saving
    ) {
      return false;
    }


    state.draft = {

      displayName:
        state.profile
          .displayName,

      avatar:
        state.profile
          .avatar
    };


    renderDraft();


    emit(
      "neyo:profile-reset"
    );


    return true;
  }


  /* =====================================================
     EXTERNAL AUTH PROFILE

     auth.js can provide authoritative identity.
     Bean ID and plan come from auth/account state.
     ===================================================== */

  function applyAuthProfile(
    profile = {}
  ) {

    if (
      !profile ||
      typeof profile !==
        "object"
    ) {
      return false;
    }


    const next = {
      ...state.profile
    };


    if (
      typeof profile.displayName ===
        "string" ||
      typeof profile.name ===
        "string"
    ) {

      next.displayName =
        cleanDisplayName(
          profile.displayName ||
          profile.name
        ) ||
        next.displayName;
    }


    const identity =
      profile.beanId ??
      profile.beanID ??
      profile.username;


    if (
      typeof identity ===
        "string" &&
      identity.trim()
    ) {

      next.username =
        normalizeUsername(
          identity
        );
    }


    if (
      typeof profile.avatar ===
        "string" ||
      profile.avatar ===
        null
    ) {

      next.avatar =
        profile.avatar;
    }


    if (
      typeof profile.plan ===
        "string"
    ) {

      next.plan =
        normalizePlan(
          profile.plan
        );
    }


    state.profile =
      next;


    state.draft = {

      displayName:
        next.displayName,

      avatar:
        next.avatar
    };


    persistProfile();

    renderSidebarProfile();

    renderDraft();


    emit(
      "neyo:profile-change",
      {
        profile: {
          ...state.profile
        },

        source:
          "auth"
      }
    );


    return true;
  }


  /* =====================================================
     PLAN UPDATE
     ===================================================== */

  function setPlan(
    plan
  ) {

    state.profile.plan =
      normalizePlan(
        plan
      );


    persistProfile();

    renderSidebarProfile();


    return state.profile.plan;
  }


  /* =====================================================
     IDENTITY UPDATE
     ===================================================== */

  function setIdentity(
    username
  ) {

    state.profile.username =
      normalizeUsername(
        username
      );


    persistProfile();

    renderDraft();


    return state.profile
      .username;
  }


  /* =====================================================
     PROFILE PANEL OPEN
     ===================================================== */

  function syncEditorFromProfile() {

    state.draft = {

      displayName:
        state.profile
          .displayName,

      avatar:
        state.profile
          .avatar
    };


    renderDraft();


    return true;
  }


  /* =====================================================
     INPUT
     ===================================================== */

  function handleNameInput() {

    state.draft.displayName =
      cleanDisplayName(
        settingsDisplayNameInput
          ?.value
      );


    renderAvatarElement(
      settingsAvatarPreview,
      state.draft.avatar,
      state.draft.displayName
    );


    syncDirtyState();
  }


  /* =====================================================
     KEYBOARD SAVE
     ===================================================== */

  function handleInputKeydown(
    event
  ) {

    if (
      event.key !==
        "Enter" ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }


    if (
      !event.ctrlKey &&
      !event.metaKey
    ) {
      return;
    }


    event.preventDefault();


    void save();
  }


  /* =====================================================
     BIND
     ===================================================== */

  function bind() {

    if (!active) {
      return false;
    }


    chooseAvatarBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          settingsAvatarFileInput
            ?.click
            ?.();
        }
      );


    settingsAvatarFileInput
      ?.addEventListener(
        "change",
        event => {

          const file =
            event.target
              ?.files?.[0];


          if (file) {

            void handleAvatarFile(
              file
            );
          }
        }
      );


    removeAvatarBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          removeAvatar();
        }
      );


    settingsDisplayNameInput
      ?.addEventListener(
        "input",
        handleNameInput
      );


    settingsDisplayNameInput
      ?.addEventListener(
        "keydown",
        handleInputKeydown
      );


    saveProfileSettingsBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          void save();
        }
      );


    resetProfileSettingsBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          resetDraft();
        }
      );


    /*
     * settings.js emits this when Profile tab opens.
     */

    window.addEventListener(
      "neyo:profile-settings-open-request",
      syncEditorFromProfile
    );


    /*
     * auth.js can send authoritative identity/profile.
     */

    window.addEventListener(
      "neyo:auth-profile",
      event => {

        applyAuthProfile(
          event.detail
            ?.profile ||
          event.detail ||
          {}
        );
      }
    );


    window.addEventListener(
      "neyo:account-plan-change",
      event => {

        const plan =
          event.detail
            ?.plan;


        if (plan) {

          setPlan(
            plan
          );
        }
      }
    );


    return true;
  }


  /* =====================================================
     INIT
     ===================================================== */

  state.profile =
    loadStoredProfile();


  state.draft = {

    displayName:
      state.profile
        .displayName,

    avatar:
      state.profile
        .avatar
  };


  if (active) {

    bind();

    renderSidebarProfile();

    renderDraft();

    state.initialized =
      true;
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


      save,


      reset:
        resetDraft,


      refresh:
        syncEditorFromProfile,


      setAuthProfile:
        applyAuthProfile,


      setPlan,


      setIdentity,


      removeAvatar,


      chooseAvatar() {

        if (!active) {
          return false;
        }


        settingsAvatarFileInput
          ?.click
          ?.();


        return true;
      },


      setDisplayName(
        value,
        {
          saveImmediately =
            false
        } = {}
      ) {

        state.draft.displayName =
          cleanDisplayName(
            value
          );


        renderDraft();


        if (
          saveImmediately
        ) {

          return save();
        }


        return state.draft
          .displayName;
      },


      getProfile() {

        return {
          ...state.profile
        };
      },


      getDraft() {

        return {
          ...state.draft
        };
      },


      isDirty:
        () =>
          computeDirty(),


      getState() {

        return {

          version:
            VERSION,

          active,

          legacyOwnerActive,

          initialized:
            state.initialized,

          dirty:
            computeDirty(),

          saving:
            state.saving,

          processingAvatar:
            state.processingAvatar,

          profile: {
            ...state.profile
          },

          draft: {
            ...state.draft
          }
        };
      }
    });


  Object.defineProperty(
    window,
    "NeyoProfile",
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


  emit(
    "neyo:profile-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive,

      profile: {
        ...state.profile
      }
    }
  );

})();
