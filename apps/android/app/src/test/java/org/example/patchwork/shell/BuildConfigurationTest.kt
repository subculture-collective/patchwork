package org.example.patchwork.shell

import java.net.URI
import org.junit.Assert.*
import org.junit.Test

class BuildConfigurationTest {
    @Test fun developmentBuildHasExplicitEnvironmentAndApi() {
        assertEquals("development", BuildConfig.ENVIRONMENT)
        assertTrue(BuildConfig.APPLICATION_ID.endsWith(".development"))
        val api = URI(BuildConfig.API_BASE_URL)
        assertTrue(api.scheme in listOf("http", "https"))
        assertNotNull(api.host)
        assertNull(api.userInfo)
    }
}
