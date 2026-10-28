package com.openpath.vpn

import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
    private fun buttons(root: View): List<Button> {
        val result = mutableListOf<Button>()
        fun visit(view: View) {
            if (view is Button) result.add(view)
            if (view is ViewGroup) for (i in 0 until view.childCount) visit(view.getChildAt(i))
        }
        visit(root)
        return result
    }
    private fun checkNavigation(wide: Boolean) {
        org.robolectric.RuntimeEnvironment.getApplication().getSharedPreferences("wireguard_profile", 0).edit().clear().commit()
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        fun all() = buttons(activity.window.decorView)
        val home = all().first { it.contentDescription?.toString()?.startsWith("Home") == true }
        assertEquals(if (wide) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL, (home.parent as LinearLayout).orientation)
        all().first { it.contentDescription?.toString()?.startsWith("Profiles") == true }.performClick()
        assertTrue(all().any { it.text.toString() == "Choose .conf file" })
        all().first { it.contentDescription?.toString()?.startsWith("Settings") == true }.performClick()
        all().first { it.contentDescription?.toString()?.startsWith("Releases") == true }.performClick()
        assertTrue(all().any { it.text.toString() == "Open GitHub releases" })
        activity.finish()
    }
    @Test @Config(sdk = [28], qualifiers = "w400dp-h800dp") fun phoneUsesBottomNavigation() = checkNavigation(false)
    @Test @Config(sdk = [28], qualifiers = "w900dp-h800dp") fun tabletUsesSidebarNavigation() = checkNavigation(true)
}
