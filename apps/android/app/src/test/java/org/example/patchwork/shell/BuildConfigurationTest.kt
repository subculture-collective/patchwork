package org.example.patchwork.shell

import java.net.URI
import org.junit.Assert.*
import org.junit.Test

class BuildConfigurationTest {
    @Test fun buildHasExplicitEnvironmentAndApi() {
        val expectedEnvironment = when (BuildConfig.BUILD_TYPE) {
            "debug" -> "development"
            "staging" -> "staging"
            "release" -> "release"
            else -> error("Unqualified build variant: ${BuildConfig.BUILD_TYPE}")
        }
        assertEquals(expectedEnvironment, BuildConfig.ENVIRONMENT)
        if (BuildConfig.BUILD_TYPE != "release") {
            assertTrue(BuildConfig.APPLICATION_ID.endsWith(".$expectedEnvironment"))
        }
        val api = URI(BuildConfig.API_BASE_URL)
        if (BuildConfig.BUILD_TYPE == "debug") {
            assertTrue(api.scheme in listOf("http", "https"))
        } else {
            assertEquals("https", api.scheme)
        }
        assertNotNull(api.host)
        assertNull(api.userInfo)
    }
}
