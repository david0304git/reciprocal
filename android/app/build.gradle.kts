plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.lutszhong.reciprocal"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.lutszhong.reciprocal"
        minSdk = 26
        targetSdk = 37
        // Mirrors the upstream Tauri app version so the GitHub release check compares like for like.
        versionCode = 2
        versionName = "0.1.8"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // Keep command-line and Android Studio builds interchangeable: AGP derives its default
        // debug keystore from ANDROID_USER_HOME, and scripts/build.sh points that inside the
        // workspace (sandboxed builds), which would generate a *second* debug key. Pinning the
        // keystore to Studio's `~/.android/debug.keystore` means `adb install -r` upgrades work
        // no matter which side produced the APK. Falls back to AGP's default when absent (CI).
        getByName("debug") {
            val studioKey = File(System.getProperty("user.home"), ".android/debug.keystore")
            if (studioKey.exists()) {
                storeFile = studioKey
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            optimization {
                enable = true
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
