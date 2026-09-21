# R8 configuration for the release build.
#
# Capacitor ships its own consumer rules (see @capacitor/android), which keep
# every @CapacitorPlugin class and its plugin methods. Those classes are found
# by reflection at runtime, so without them the app builds cleanly and then
# fails to load the bridge at all — a blank white WebView with nothing in the
# log to explain it. Everything below covers what those consumer rules do not.
#
# This app installs exactly one Capacitor plugin, @capacitor/app, and uses it
# for one thing: the Android Back button. Everything else is HTML, CSS and
# vanilla JS talking to browser APIs, so the plugin surface to keep is small.

# The bridge exposes methods to JavaScript by annotation, and R8 has no way to
# see those call sites because they come from inside the WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor reads its configuration and posts results back as JSON, both of
# which walk fields reflectively.
-keep class com.getcapacitor.** { *; }

# Kept because capacitor.build.gradle wires the Cordova compatibility module in
# unconditionally, even with no Cordova plugins present.
-keep class org.apache.cordova.** { *; }

# The plugins this app declares, kept by name. Capacitor instantiates them
# reflectively from the generated plugin list, so a rename by R8 breaks them
# with no error at all - Back simply exits again, and reminders never fire.
-keep class com.capacitorjs.plugins.app.** { *; }
-keep class com.capacitorjs.plugins.localnotifications.** { *; }

# The notification receivers are named as strings in the merged manifest,
# which R8 cannot see as class references.
-keep class * extends android.content.BroadcastReceiver { *; }

# Keep the app's own entry point, which the manifest names as a string
# (android:name=".MainActivity"). R8 cannot see a string as a class reference.
-keep class com.john3004.calorietracker.MainActivity { *; }

# AndroidX WebKit talks to a WebView provider loaded reflectively by the
# platform, so the classes it hands over must keep their names.
-keep class androidx.webkit.** { *; }

# Crash reports from Play are unreadable without these, and they cost almost
# nothing: line numbers survive while class and method names are still renamed,
# so the mapping file stays useful and the APK stays small.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations drive the bridge's method dispatch, so they must survive.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
