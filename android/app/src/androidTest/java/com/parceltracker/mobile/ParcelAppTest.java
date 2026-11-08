package com.parceltracker.mobile;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ParcelAppTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue("JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private String async(ActivityScenario<MainActivity> scenario, String code) throws Exception {
        evaluate(scenario, "window.__parcelTest=null; (async()=>{" + code + "})().then(v=>window.__parcelTest=JSON.stringify({ok:true,value:v})).catch(e=>window.__parcelTest=JSON.stringify({ok:false,error:e.message}));");
        for (int i=0; i<200; i++) {
            String value = evaluate(scenario, "window.__parcelTest");
            if (!"null".equals(value)) {
                String decoded = new org.json.JSONArray("[" + value + "]").getString(0);
                JSONObject response = new JSONObject(decoded);
                assertTrue(response.optString("error"), response.getBoolean("ok"));
                return response.get("value").toString();
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Native bridge did not complete");
    }
    private void ready(ActivityScenario<MainActivity> scenario) throws Exception {
        for (int i=0; i<200; i++) {
            if ("true".equals(evaluate(scenario, "!!window.parcelDesktop"))) { async(scenario, "return await window.parcelDesktop.settings();"); return; }
            Thread.sleep(100);
        }
        throw new AssertionError("Parcel UI did not initialize");
    }
    @Test public void emptyWorkspacePersistsRealSavedParcelAcrossRestartAndProtectsSecrets() throws Exception {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase("parcels.sqlite");
        context.getSharedPreferences("parcel-secure", 0).edit().clear().commit();
        String id;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            assertEquals("[]", async(scenario, "return await window.parcelDesktop.request('/parcels');"));
            String saved = async(scenario, "return await window.parcelDesktop.request('/parcels',{method:'POST',body:JSON.stringify({number:'NATIVEPERSIST123',carrier:100003,nickname:'Android persisted parcel'})});");
            id = new JSONObject(saved).getString("id");
            JSONObject duplicate = new JSONObject(async(scenario, "return await window.parcelDesktop.request('/parcels',{method:'POST',body:JSON.stringify({number:'NATIVEPERSIST123',carrier:100003})});"));
            assertEquals(id, duplicate.getString("id")); assertTrue(duplicate.getBoolean("reused"));
            async(scenario, "await window.parcelDesktop.saveSettings({RESEND_KEY:'native-encryption-check'}); return true;");
            String preferences = context.getSharedPreferences("parcel-secure", 0).getString("settings", "");
            assertFalse(preferences.contains("native-encryption-check")); assertTrue(preferences.length() > 30);
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            JSONObject parcel = new JSONObject(async(scenario, "return await window.parcelDesktop.request('/parcels/" + id + "');"));
            assertEquals("NATIVEPERSIST123", parcel.getString("number"));
            assertEquals("Android persisted parcel", parcel.getString("nickname"));
            assertEquals("error", parcel.getString("registration"));
            assertTrue(parcel.getString("problem").contains("API key"));
            JSONObject settings = new JSONObject(async(scenario, "return await window.parcelDesktop.settings();"));
            assertTrue(settings.getBoolean("hasResend")); assertFalse(settings.getBoolean("configured"));
            assertFalse(settings.has("RESEND_KEY"));
        }
    }
}
