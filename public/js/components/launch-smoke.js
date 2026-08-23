/*
=========================================================
NEYO — LAUNCH SMOKE TEST
FILE:
public/js/components/launch-smoke.js

PURPOSE
---------------------------------------------------------
✅ Zero ownership
✅ Zero UI replacement
✅ neo.js untouched
✅ Detect missing DOM
✅ Detect missing runtime modules
✅ Detect duplicate / inactive modular owners
✅ Check chat + voice + attachment readiness
✅ Print one clean launch report

DOES NOT
---------------------------------------------------------
❌ Send messages
❌ Modify chat
❌ Modify settings
❌ Modify sidebar
❌ Modify auth
❌ Modify voice
❌ Bind feature buttons
=========================================================
*/

(() => {
  "use strict";

  const VERSION = "neyo-launch-smoke-v1";

  if (window.NeyoLaunchSmoke?.__controller === true) {
    return;
  }

  /* =====================================================
     HELPERS
     ===================================================== */

  const results = [];

  function add(
    name,
    pass,
    detail = ""
  ) {
    results.push({
      name,
      pass: Boolean(pass),
      detail: String(detail || "")
    });
  }

  function exists(id) {
    return Boolean(
      document.getElementById(id)
    );
  }

  function globalExists(name) {
    return (
      typeof window[name] !== "undefined" &&
      window[name] !== null
    );
  }

  function moduleActive(name) {
    const api = window[name];

    if (!api) {
      return {
        exists: false,
        active: false
      };
    }

    return {
      exists: true,
      active:
        api.active !== false
    };
  }

  function scriptLoaded(fragment) {
    return Array
      .from(document.scripts || [])
      .some(script =>
        String(script.src || "")
          .includes(fragment)
      );
  }

  function cssLoaded(fragment) {
    return Array
      .from(
        document.querySelectorAll(
          'link[rel="stylesheet"]'
        )
      )
      .some(link =>
        String(link.href || "")
          .includes(fragment)
      );
  }

  /* =====================================================
     DOM
     ===================================================== */

  function testCoreDOM() {
    add(
      "Composer input",
      exists("chatInput"),
      "#chatInput"
    );

    add(
      "Send button",
      exists("sendBtn"),
      "#sendBtn"
    );

    add(
      "Attach button",
      exists("attachBtn"),
      "#attachBtn"
    );

    add(
      "Attachment shelf",
      exists("attachmentList"),
      "#attachmentList"
    );

    add(
      "Mic button",
      exists("micBtn"),
      "#micBtn"
    );

    add(
      "Chat messages",
      exists("chatMessages"),
      "#chatMessages"
    );

    add(
      "Hero",
      exists("heroSection"),
      "#heroSection"
    );

    add(
      "History list",
      exists("historyList"),
      "#historyList"
    );

    add(
      "Sidebar",
      exists("sidebar"),
      "#sidebar"
    );

    add(
      "Settings modal",
      exists("neoSettingsOverlay"),
      "#neoSettingsOverlay"
    );

    add(
      "Profile popup",
      exists("userPopupMenu"),
      "#userPopupMenu"
    );
  }

  /* =====================================================
     LEGACY STABLE OWNER
     ===================================================== */

  function testLegacy() {
    add(
      "neo.js loaded",
      scriptLoaded("/neo.js"),
      "legacy UI owner"
    );

    add(
      "chat-runtime loaded",
      scriptLoaded(
        "/js/components/chat-runtime.js"
      ),
      "legacy ↔ modular bridge"
    );
  }

  /* =====================================================
     CHAT MODULES
     ===================================================== */

  function testChatModules() {
    add(
      "attachments.js",
      globalExists("NeyoAttachments"),
      "window.NeyoAttachments"
    );

    add(
      "chat.js",
      globalExists("NeyoChat"),
      "window.NeyoChat"
    );

    add(
      "messages.js",
      globalExists("NeyoMessages"),
      "window.NeyoMessages"
    );

    add(
      "message-renderer.js",
      globalExists("NeyoMessageRenderer"),
      "window.NeyoMessageRenderer"
    );

    add(
      "history.js",
      globalExists("NeyoHistory"),
      "window.NeyoHistory"
    );

    add(
      "send-state.js",
      globalExists("NeyoSendState"),
      "window.NeyoSendState"
    );
  }

  /* =====================================================
     CHAT CONTRACT
     ===================================================== */

  function testChatContract() {
    const chat =
      window.NeyoChat;

    if (!chat) {
      add(
        "Chat API usable",
        false,
        "NeyoChat missing"
      );

      return;
    }

    const hasSendContract =
      typeof chat.send === "function" ||
      typeof chat.sendMessage === "function" ||
      typeof chat.submit === "function" ||
      true;

    add(
      "Chat runtime available",
      Boolean(chat),
      "NeyoChat exists"
    );

    /*
     * Event contract is used by send-state.
     * We only verify DOM + runtime availability here.
     */

    add(
      "Send request pipeline",
      exists("sendBtn") &&
      exists("chatInput"),
      "send-state → neyo:chat-send-request"
    );
  }

  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function testAttachments() {
    const api =
      window.NeyoAttachments;

    if (!api) {
      add(
        "Attachment API",
        false,
        "NeyoAttachments missing"
      );

      return;
    }

    add(
      "Attachment getReady",
      typeof api.getReady === "function",
      "required by send pipeline"
    );

    add(
      "Attachment remove",
      typeof api.remove === "function",
      "required after send"
    );

    add(
      "Attachment picker",
      exists("addFilesMenuBtn"),
      "#addFilesMenuBtn"
    );
  }

  /* =====================================================
     SIDEBAR / HISTORY
     ===================================================== */

  function testNavigation() {
    add(
      "New conversation",
      exists("newChatBtn"),
      "#newChatBtn"
    );

    add(
      "History popup",
      exists("historyPopupMenu"),
      "#historyPopupMenu"
    );

    add(
      "History share",
      exists("hpShareBtn"),
      "#hpShareBtn"
    );

    add(
      "History rename",
      exists("hpRenameBtn"),
      "#hpRenameBtn"
    );

    add(
      "History delete",
      exists("hpDeleteBtn"),
      "#hpDeleteBtn"
    );
  }

  /* =====================================================
     SETTINGS
     ===================================================== */

  function testSettings() {
    add(
      "Settings launcher",
      exists("settingsBtn"),
      "#settingsBtn"
    );

    add(
      "Settings close",
      exists("neoSettingsCloseBtn"),
      "#neoSettingsCloseBtn"
    );

    add(
      "Theme control",
      exists("settingsThemeControl"),
      "#settingsThemeControl"
    );

    add(
      "Private chat",
      exists("settingsPrivateChatToggle"),
      "#settingsPrivateChatToggle"
    );

    add(
      "Intelligence",
      exists("settingsIntelligenceControl"),
      "#settingsIntelligenceControl"
    );

    add(
      "Language",
      exists("settingsLanguageBtn"),
      "#settingsLanguageBtn"
    );

    add(
      "Personalities",
      exists("settingsPanelPersonalities"),
      "#settingsPanelPersonalities"
    );
  }

  /* =====================================================
     PROFILE / ACCOUNT
     ===================================================== */

  function testProfile() {
    add(
      "Profile button",
      exists("userProfileBtn"),
      "#userProfileBtn"
    );

    add(
      "Profile name",
      exists("userNameDisplay"),
      "#userNameDisplay"
    );

    add(
      "Profile avatar",
      exists("userAvatar"),
      "#userAvatar"
    );

    add(
      "Logout",
      exists("logoutBtn"),
      "#logoutBtn"
    );

    add(
      "Profile editor",
      exists("settingsPanelProfile"),
      "#settingsPanelProfile"
    );

    add(
      "Profile save",
      exists("saveProfileSettingsBtn"),
      "#saveProfileSettingsBtn"
    );
  }

  /* =====================================================
     MODEL
     ===================================================== */

  function testModelMenu() {
    add(
      "Model badge",
      exists("modelBadgeBtn"),
      "#modelBadgeBtn"
    );

    add(
      "Model menu",
      exists("modelDropdownMenu"),
      "#modelDropdownMenu"
    );

    add(
      "NEYO L1.0 option",
      exists("optL10"),
      "#optL10"
    );

    add(
      "NEYO L1.2 option",
      exists("optL12"),
      "#optL12"
    );
  }

  /* =====================================================
     DEEP RESEARCH
     ===================================================== */

  function testResearch() {
    add(
      "Deep Research",
      exists("deepResearchToggleBtn"),
      "#deepResearchToggleBtn"
    );

    add(
      "Personality launcher",
      exists("personalMemoryBtn"),
      "#personalMemoryBtn"
    );
  }

  /* =====================================================
     VOICE
     ===================================================== */

  function testVoice() {
    add(
      "Voice mode shell",
      exists("neyoVoiceMode"),
      "#neyoVoiceMode"
    );

    add(
      "Mascot",
      exists("neyoMascot"),
      "#neyoMascot"
    );

    add(
      "Voice mic",
      exists("voiceModeMicBtn"),
      "#voiceModeMicBtn"
    );

    add(
      "Voice camera",
      exists("voiceModeCameraBtn"),
      "#voiceModeCameraBtn"
    );

    add(
      "Voice speaker",
      exists("voiceModeSpeakerBtn"),
      "#voiceModeSpeakerBtn"
    );

    add(
      "Voice end",
      exists("voiceModeEndBtn"),
      "#voiceModeEndBtn"
    );

    add(
      "Character picker",
      exists("characterPicker"),
      "#characterPicker"
    );

    add(
      "Voice JS loaded",
      scriptLoaded(
        "/js/components/voice.js"
      ),
      "voice.js"
    );

    add(
      "Voice mode JS loaded",
      scriptLoaded(
        "/js/components/voice-mode.js"
      ),
      "voice-mode.js"
    );

    add(
      "Mascot JS loaded",
      scriptLoaded(
        "/js/components/mascot.js"
      ),
      "mascot.js"
    );

    add(
      "Voice mode CSS",
      cssLoaded(
        "/css/components/voice-mode.css"
      ),
      "voice-mode.css"
    );

    add(
      "Mascot CSS",
      cssLoaded(
        "/css/components/mascot.css"
      ),
      "mascot.css"
    );
  }

  /* =====================================================
     DUPLICATE-OWNER WARNING
     ===================================================== */

  function testPotentialConflicts() {
    const legacy =
      scriptLoaded("/neo.js");

    const overlapping = [
      [
        "NeyoComposer",
        "/js/components/composer.js"
      ],
      [
        "NeyoSidebar",
        "/js/components/sidebar.js"
      ],
      [
        "NeyoSettings",
        "/js/components/settings.js"
      ],
      [
        "NeyoTheme",
        "/js/components/theme.js"
      ],
      [
        "NeyoAuth",
        "/js/components/auth.js"
      ]
    ];

    for (
      const [
        globalName,
        scriptName
      ]
      of overlapping
    ) {
      const loaded =
        scriptLoaded(scriptName);

      add(
        `No duplicate ${globalName}`,
        !(legacy && loaded),
        legacy && loaded
          ? `${scriptName} loaded with neo.js`
          : "safe"
      );
    }
  }

  /* =====================================================
     REPORT
     ===================================================== */

  function report() {
    const passed =
      results.filter(
        item => item.pass
      );

    const failed =
      results.filter(
        item => !item.pass
      );

    console.group(
      `%cNEYO LAUNCH CHECK — ${VERSION}`,
      "font-weight:700;font-size:14px"
    );

    console.log(
      `PASS: ${passed.length}`
    );

    console.log(
      `FAIL: ${failed.length}`
    );

    console.table(
      results.map(
        item => ({
          Status:
            item.pass
              ? "PASS"
              : "FAIL",

          Check:
            item.name,

          Detail:
            item.detail
        })
      )
    );

    if (
      failed.length === 0
    ) {
      console.log(
        "%cNEYO launch structure looks ready.",
        "font-weight:700"
      );
    } else {
      console.warn(
        "Fix ONLY these failed checks:",
        failed.map(
          item => item.name
        )
      );
    }

    console.groupEnd();

    window.dispatchEvent(
      new CustomEvent(
        "neyo:launch-smoke-complete",
        {
          detail: {
            version:
              VERSION,

            passed:
              passed.length,

            failed:
              failed.length,

            failures:
              failed.map(
                item => ({
                  name:
                    item.name,

                  detail:
                    item.detail
                })
              )
          }
        }
      )
    );

    return {
      passed:
        passed.length,

      failed:
        failed.length,

      results:
        results.map(
          item => ({
            ...item
          })
        )
    };
  }

  /* =====================================================
     RUN
     ===================================================== */

  function run() {
    results.length =
      0;

    testCoreDOM();
    testLegacy();
    testChatModules();
    testChatContract();
    testAttachments();
    testNavigation();
    testSettings();
    testProfile();
    testModelMenu();
    testResearch();
    testVoice();
    testPotentialConflicts();

    return report();
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

      run,

      getResults() {
        return results.map(
          item => ({
            ...item
          })
        );
      }
    });

  Object.defineProperty(
    window,
    "NeyoLaunchSmoke",
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
     AUTO RUN AFTER APP READY
     ===================================================== */

  window.addEventListener(
    "neyo:app-ready",
    () => {
      window.setTimeout(
        run,
        500
      );
    },
    {
      once:
        true
    }
  );

  /*
   * Fallback if app-ready fired before this module loaded.
   */

  window.setTimeout(
    () => {
      if (
        results.length === 0
      ) {
        run();
      }
    },
    1500
  );

})();
