package com.parceltracker.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Iterator;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "ParcelStore")
public class ParcelStorePlugin extends Plugin {
    private SQLiteDatabase db;
    private static final String[] TABLES = {"parcels", "scans", "catalog", "digests"};
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("api.17track.net", "res.17track.net", "api.resend.com"));
    private byte[] readBytes(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > 50 * 1024 * 1024) throw new Exception("File or response exceeds 50 MB");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    @PluginMethod public void initialize(PluginCall call) {
        try {
            db = getContext().openOrCreateDatabase("parcels.sqlite", 0, null);
            db.execSQL("PRAGMA foreign_keys=ON");
            db.enableWriteAheadLogging();
            try (Cursor c = db.rawQuery("SELECT name FROM sqlite_master WHERE name='parcels'", null)) {
                if (!c.moveToFirst()) {
                    db.beginTransaction();
                    try {
                        for (String sql : call.getString("schema", "").replaceAll("(?m)^--.*$", "").split(";")) if (!sql.trim().isEmpty()) db.execSQL(sql);
                        db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                }
            }
            call.resolve();
        } catch (Exception e) { call.reject("Unable to open local database: " + e.getMessage()); }
    }
    private String[] queryArgs(JSONArray args) throws Exception {
        String[] result = new String[args.length()];
        for (int i=0; i<result.length; i++) result[i] = args.isNull(i) ? null : args.get(i).toString();
        return result;
    }
    private JSArray rows(String sql, JSONArray args) throws Exception {
        JSArray result = new JSArray();
        try (Cursor c = db.rawQuery(sql, queryArgs(args))) {
            while (c.moveToNext()) {
                JSObject row = new JSObject();
                for (int i=0; i<c.getColumnCount(); i++) {
                    switch (c.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL: row.put(c.getColumnName(i), JSONObject.NULL); break;
                        case Cursor.FIELD_TYPE_INTEGER: row.put(c.getColumnName(i), c.getLong(i)); break;
                        case Cursor.FIELD_TYPE_FLOAT: row.put(c.getColumnName(i), c.getDouble(i)); break;
                        default: row.put(c.getColumnName(i), c.getString(i));
                    }
                }
                result.put(row);
            }
        }
        return result;
    }
    @PluginMethod public void query(PluginCall call) {
        try { call.resolve(new JSObject().put("results", rows(call.getString("sql"), call.getArray("args", new JSArray())))); }
        catch (Exception e) { call.reject("Database read failed: " + e.getMessage()); }
    }
    private JSObject executeStatement(String sql, JSONArray args) throws Exception {
        try (SQLiteStatement stmt = db.compileStatement(sql)) {
            for (int i=0; i<args.length(); i++) {
                Object value = args.get(i);
                if (value == JSONObject.NULL) stmt.bindNull(i+1);
                else if (value instanceof Float || value instanceof Double) stmt.bindDouble(i+1, ((Number)value).doubleValue());
                else if (value instanceof Number) stmt.bindLong(i+1, ((Number)value).longValue());
                else stmt.bindString(i+1, value.toString());
            }
            int changes = stmt.executeUpdateDelete();
            return new JSObject().put("meta", new JSObject().put("changes", changes));
        }
    }
    @PluginMethod public void execute(PluginCall call) {
        try { call.resolve(executeStatement(call.getString("sql"), call.getArray("args", new JSArray()))); }
        catch (Exception e) { call.reject("Database write failed: " + e.getMessage()); }
    }
    @PluginMethod public void batch(PluginCall call) {
        try {
            db.beginTransaction();
            try {
                JSONArray statements = call.getArray("statements");
                for (int i=0; i<statements.length(); i++) { JSONObject s = statements.getJSONObject(i); executeStatement(s.getString("sql"), s.getJSONArray("args")); }
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            call.resolve();
        } catch (Exception e) { call.reject("Database transaction failed: " + e.getMessage()); }
    }
    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias("parcel-settings-v1")) return ((KeyStore.SecretKeyEntry)store.getEntry("parcel-settings-v1", null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder("parcel-settings-v1", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private JSObject settings() throws Exception {
        String saved = getContext().getSharedPreferences("parcel-secure", 0).getString("settings", null);
        if (saved == null) return new JSObject();
        String[] parts = saved.split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new JSObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    @PluginMethod public void readSettings(PluginCall call) {
        try { call.resolve(settings()); }
        catch (Exception e) { call.reject("Android could not decrypt saved API settings. Clear app storage to reset settings."); }
    }
    @PluginMethod public void saveSettings(PluginCall call) {
        try {
            JSObject next = settings(); JSONObject input = call.getObject("settings", new JSObject());
            for (String field : new String[]{"TRACK17_KEY", "RESEND_KEY", "OWNER_EMAIL", "EMAIL_FROM"}) if (input.has(field)) next.put(field, input.getString(field));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            String saved = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!getContext().getSharedPreferences("parcel-secure", 0).edit().putString("settings", saved).commit()) throw new Exception("Storage unavailable");
            call.resolve(next);
        } catch (Exception e) { call.reject("Unable to securely save settings: " + e.getMessage()); }
    }
    @PluginMethod public void http(PluginCall call) {
        getBridge().execute(() -> {
            HttpsURLConnection connection = null;
            try {
                URL url = new URL(call.getString("url"));
                if (!"https".equals(url.getProtocol()) || !HOSTS.contains(url.getHost()) || (url.getPort() != -1 && url.getPort() != 443)) throw new Exception("Blocked network destination");
                connection = (HttpsURLConnection)url.openConnection(); connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(25000); connection.setReadTimeout(25000);
                connection.setRequestMethod(call.getString("method", "GET"));
                JSONObject headers = call.getObject("headers", new JSObject());
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) { String key = keys.next(); connection.setRequestProperty(key, headers.getString(key)); }
                String body = call.getString("body");
                if (body != null && !body.isEmpty()) { connection.setDoOutput(true); try(OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); } }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String response = stream == null ? "" : new String(readBytes(stream), StandardCharsets.UTF_8);
                if (stream != null) stream.close();
                call.resolve(new JSObject().put("status", status).put("body", response).put("headers", new JSObject()));
            } catch (Exception e) { call.reject("Network request failed: " + e.getMessage()); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    @PluginMethod public void backup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, "parcel-backup.json");
        startActivityForResult(call, intent, "backupResult");
    }
    @ActivityCallback private void backupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("saved", false)); return; }
        try {
            JSObject tables = new JSObject(); for (String table : TABLES) tables.put(table, rows("SELECT * FROM " + table, new JSONArray()));
            byte[] bytes = new JSObject().put("format", "parcel-backup-v1").put("tables", tables).toString(2).getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) { out.write(bytes); }
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception e) { call.reject("Backup failed: " + e.getMessage()); }
    }
    @PluginMethod public void restore(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
        startActivityForResult(call, intent, "restoreResult");
    }
    @ActivityCallback private void restoreResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("restored", false)); return; }
        try {
            JSONObject data;
            try (InputStream in = getContext().getContentResolver().openInputStream(result.getData().getData())) { data = new JSONObject(new String(readBytes(in), StandardCharsets.UTF_8)); }
            if (!"parcel-backup-v1".equals(data.getString("format"))) throw new Exception("Not a Parcel backup");
            JSONObject tables = data.getJSONObject("tables");
            for (String table : TABLES) tables.getJSONArray(table);
            getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity()).setTitle("Restore backup?").setMessage("This replaces all parcels and history on this device. Your API settings stay unchanged.").setNegativeButton("Cancel", (d,w) -> call.resolve(new JSObject().put("restored", false))).setPositiveButton("Restore", (d,w) -> {
                try {
                    db.beginTransaction();
                    try {
                        for (String table : new String[]{"scans", "parcels", "catalog", "digests"}) db.execSQL("DELETE FROM " + table);
                        for (String table : TABLES) {
                            Set<String> columns = new HashSet<>(); try(Cursor c = db.rawQuery("PRAGMA table_info(" + table + ")", null)) { while(c.moveToNext()) columns.add(c.getString(1)); }
                            JSONArray records = tables.getJSONArray(table);
                            for (int i=0; i<records.length(); i++) {
                                JSONObject row = records.getJSONObject(i); Iterator<String> keys = row.keys(); StringBuilder names = new StringBuilder(), placeholders = new StringBuilder(); JSONArray args = new JSONArray();
                                while(keys.hasNext()) { String key = keys.next(); if (!columns.contains(key)) throw new Exception("Invalid backup column"); if (args.length()>0) { names.append(','); placeholders.append(','); } names.append(key); placeholders.append('?'); args.put(row.get(key)); }
                                executeStatement("INSERT INTO " + table + " (" + names + ") VALUES (" + placeholders + ")", args);
                            }
                        }
                        db.setTransactionSuccessful();
                    } finally { db.endTransaction(); }
                    call.resolve(new JSObject().put("restored", true));
                } catch(Exception e) { call.reject("Restore failed; existing data retained: " + e.getMessage()); }
            }).setOnCancelListener(d -> call.resolve(new JSObject().put("restored", false))).show());
        } catch (Exception e) { call.reject("Unable to read backup: " + e.getMessage()); }
    }
}
