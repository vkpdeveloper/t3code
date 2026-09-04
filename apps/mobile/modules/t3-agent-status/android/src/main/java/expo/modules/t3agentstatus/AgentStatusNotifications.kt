package expo.modules.t3agentstatus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Builds the single ongoing notification that lists every active agent task.
 *
 * The notification is silent, cannot be swiped away, and uses the platform
 * chronometer anchored at the oldest task start so the elapsed timer ticks
 * without any JavaScript running. On Android 16 QPR1 it requests promotion
 * to a Live Update so the status chip appears in the status bar.
 */
object AgentStatusNotifications {
  const val STATUS_CHANNEL_ID = "t3code.agent-status"
  const val ALERT_CHANNEL_ID = "t3code.agent-alerts"
  const val STATUS_NOTIFICATION_ID = 0x7301

  /** setRequestPromotedOngoing and ProgressStyle exist from API 36.1 (Android 16 QPR1). */
  const val PROMOTED_NOTIFICATIONS_SDK = 36

  private const val MAX_LISTED_ROWS = 6
  private const val MAX_CHIP_LENGTH = 7

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val status = NotificationChannel(
      STATUS_CHANNEL_ID,
      "Agent status",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Ongoing summary of coding agents working across your machines."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    val alerts = NotificationChannel(
      ALERT_CHANNEL_ID,
      "Agent alerts",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "An agent finished, failed, or needs your approval or input."
    }
    manager.createNotificationChannel(status)
    manager.createNotificationChannel(alerts)
  }

  fun canPostPromoted(manager: NotificationManager): Boolean {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_SDK) return false
    // canPostPromotedNotifications shipped in API 36.1. Reflection keeps this
    // compiling against compileSdk 36 while still working on QPR1 devices.
    return try {
      val method = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
      method.invoke(manager) as? Boolean ?: false
    } catch (_: ReflectiveOperationException) {
      false
    }
  }

  fun build(context: Context, summary: AgentStatusSummary): Notification {
    val rows = summary.rows
    val count = rows.size
    val title = when (count) {
      0 -> "No agents running"
      1 -> "1 agent working"
      else -> "$count agents working"
    }
    val firstRow = rows.firstOrNull()
    val earliestStartMs = rows.mapNotNull { it.startedAtMs }.minOrNull()
    val contentText = firstRow?.let { rowLine(it) } ?: machinesLine(summary.environmentCount)

    val builder = NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(contentText)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent(context, summary, firstRow))

    if (count > 0) {
      val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
      rows.take(MAX_LISTED_ROWS).forEach { style.addLine(rowLine(it)) }
      style.setSummaryText(
        if (count > MAX_LISTED_ROWS) {
          "${count - MAX_LISTED_ROWS} more, ${machinesLine(summary.environmentCount)}"
        } else {
          machinesLine(summary.environmentCount)
        },
      )
      builder.setStyle(style)
    }

    if (earliestStartMs != null) {
      // The system renders the elapsed time from this origin, so the timer
      // ticks without any process wake-ups.
      builder.setWhen(earliestStartMs.toLong()).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
    }

    // Only working agents earn the status-bar chip; an idle summary stays a
    // plain ongoing notification.
    if (count > 0 && Build.VERSION.SDK_INT >= PROMOTED_NOTIFICATIONS_SDK) {
      builder.setRequestPromotedOngoing(true)
      builder.setShortCriticalText(chipText(count))
    }

    return builder.build()
  }

  private fun rowLine(row: AgentStatusRow): String {
    val where = listOf(row.environmentLabel, row.projectTitle)
      .filter { it.isNotBlank() }
      .joinToString(" / ")
    val prefix = if (where.isBlank()) "" else "$where: "
    return "$prefix${row.threadTitle.ifBlank { "Untitled task" }} (${row.phaseLabel})"
  }

  private fun machinesLine(environmentCount: Int): String =
    when (environmentCount) {
      0 -> "No machines connected"
      1 -> "1 machine connected"
      else -> "$environmentCount machines connected"
    }

  private fun chipText(count: Int): String {
    val text = if (count == 1) "1 agent" else "$count agents"
    return if (text.length <= MAX_CHIP_LENGTH) text else "$count"
  }

  private fun openAppIntent(
    context: Context,
    summary: AgentStatusSummary,
    firstRow: AgentStatusRow?,
  ): PendingIntent {
    // A single task deep links straight to it; several tasks land on Home.
    val path = if (summary.rows.size == 1 && firstRow != null) firstRow.deepLink else "/"
    val uri = Uri.parse("${summary.launchUrlScheme}://${path.trimStart('/')}")
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(
      context,
      STATUS_NOTIFICATION_ID,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Reuses the expo-notifications small icon when the config plugin registered one. */
  private fun smallIcon(context: Context): Int {
    val fromResources = context.resources.getIdentifier(
      "notification_icon",
      "drawable",
      context.packageName,
    )
    if (fromResources != 0) return fromResources
    val appInfo: ApplicationInfo = context.applicationInfo
    return appInfo.icon
  }
}
