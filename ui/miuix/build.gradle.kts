import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsEnvSpec
import org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsPlugin

plugins {
    kotlin("multiplatform") version "2.4.20"
    id("org.jetbrains.compose") version "1.12.0"
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20"
}

kotlin {
    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName = "muiscMiuix"
        browser {
            commonWebpackConfig {
                outputFileName = "muiscMiuix.js"
                output?.apply { globalObject = "globalThis" }
            }
        }
        binaries.executable()
    }

    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.compose.runtime:runtime:1.12.0")
            implementation("org.jetbrains.compose.foundation:foundation:1.12.0")
            implementation("org.jetbrains.compose.ui:ui:1.12.0")
            implementation("org.jetbrains.compose.components:components-resources:1.12.0")

            // Version-pinned Miuix Central release matching the local source's
            // BuildConfig.LIBRARY_VERSION. Gradle selects the -wasm-js artifacts.
            implementation("top.yukonga.miuix.kmp:miuix-ui:0.9.4")
            implementation("top.yukonga.miuix.kmp:miuix-preference:0.9.4")
            implementation("top.yukonga.miuix.kmp:miuix-icons:0.9.4")
            implementation("top.yukonga.miuix.kmp:miuix-squircle:0.9.4")
        }
    }
}

compose.resources {
    packageOfResClass = "com.muisc.ui.resources"
}

// Reuse the installed Node.js instead of downloading a second toolchain into
// Gradle's user cache.
plugins.withType<NodeJsPlugin> {
    the<NodeJsEnvSpec>().download = false
}
