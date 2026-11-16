import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val configuredId = providers.gradleProperty("patchworkApplicationId")
val configuredApi = providers.gradleProperty("patchworkApiBaseUrl")
configuredId.orNull?.let { require(Regex("[a-zA-Z][a-zA-Z0-9_]*([.][a-zA-Z][a-zA-Z0-9_]*)+").matches(it)) }
configuredApi.orNull?.let { value ->
    val uri = URI(value)
    require(uri.scheme in listOf("http", "https") && uri.host != null && uri.userInfo == null && uri.fragment == null)
}
android {
    namespace = "org.example.patchwork.shell"
    compileSdk = 36
    defaultConfig {
        // Reserved test namespace, not a claim to an owned store identifier.
        applicationId = configuredId.getOrElse("org.example.patchwork.shell")
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        debug {
            isPseudoLocalesEnabled = true
            applicationIdSuffix = ".development"
            buildConfigField("String", "ENVIRONMENT", "\"development\"")
            buildConfigField("String", "API_BASE_URL", "\"${configuredApi.getOrElse("http://10.0.2.2:4000")}\"")
            manifestPlaceholders["cleartextAllowed"] = "true"
        }
        create("staging") {
            initWith(getByName("debug"))
            isPseudoLocalesEnabled = false
            applicationIdSuffix = ".staging"
            matchingFallbacks += listOf("debug")
            buildConfigField("String", "ENVIRONMENT", "\"staging\"")
            buildConfigField("String", "API_BASE_URL", "\"${configuredApi.getOrElse("https://staging.patchwork.invalid/api")}\"")
            manifestPlaceholders["cleartextAllowed"] = "false"
        }
        release {
            buildConfigField("String", "ENVIRONMENT", "\"release\"")
            buildConfigField("String", "API_BASE_URL", "\"${configuredApi.getOrElse("")}\"")
            manifestPlaceholders["cleartextAllowed"] = "false"
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/public-geography"))
    testOptions.unitTests.all {
        it.systemProperty("patchwork.contracts", rootProject.file("../../packages/mobile-contracts/fixtures").absolutePath)
        it.systemProperty("patchwork.geography", rootProject.file("../../packages/at-lexicons/src").absolutePath)
    }
}

val bundlePublicGeography by tasks.registering(Copy::class) {
    from(rootProject.file("../../packages/at-lexicons/src")) {
        include("postal-index.json", "county-index.json", "geography-names.json")
    }
    into(layout.buildDirectory.dir("generated/public-geography"))
}
tasks.named("preBuild") { dependsOn(bundlePublicGeography) }

gradle.taskGraph.whenReady {
    if (allTasks.any { it.project == project && it.name.contains("Release") }) {
        require(configuredId.isPresent && !configuredId.get().startsWith("org.example.")) {
            "Release requires an explicitly owned -PpatchworkApplicationId."
        }
        require(configuredApi.isPresent && URI(configuredApi.get()).let {
            it.scheme == "https" && it.host != null && it.userInfo == null
        }) { "Release requires an explicit HTTPS -PpatchworkApiBaseUrl." }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
