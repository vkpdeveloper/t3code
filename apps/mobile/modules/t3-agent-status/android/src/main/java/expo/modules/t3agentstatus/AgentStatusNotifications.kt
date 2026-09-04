package expo.modules.t3agentstatus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat

/**
 * Builds the single ongoing notification that summarizes active agent tasks.
 *
 * Two renderings share one content model:
 * - Live Update (Android 16 QPR1+, when allowed and the user keeps it on):
 *   the stock template, promoted, with a status-bar chip. No progress bar;
 *   an agent has no meaningful percentage.
 * - Custom: a compact row layout inside the system's decorated card. The
 *   collapsed row is the first agent, the expanded view lists every agent.
 *   Text follows the system palette; only the phase dot takes the theme
 *   accent, so the card reads as native rather than a box inside a box.
 */
object AgentStatusNotifications {
  const val STATUS_CHANNEL_ID = "t3code.agent-status"
  const val ALERT_CHANNEL_ID = "t3code.agent-alerts"
  const val STATUS_NOTIFICATION_ID = 0x7301

  /** Promoted ongoing notifications require Android 16 QPR1. */
  const val PROMOTED_NOTIFICATIONS_SDK = 36

  private const val MAX_LISTED_ROWS = 6
  private const val MAX_CHIP_LENGTH = 7
  private const val APPROVAL_COLOR = "#f59e0b"
  private const val INPUT_COLOR = "#3b82f6"
  private val STARTING_COLOR = Color.parseColor("#9ca3af")

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
    // Reflection keeps the module compatible with API 36 SDKs that predate
    // the QPR1 method while still calling NotificationManager at runtime.
    return try {
      val method = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
      method.invoke(manager) as? Boolean ?: false
    } catch (_: ReflectiveOperationException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  fun build(context: Context, summary: AgentStatusSummary): Notification {
    val rows = summary.rows
    val firstRow = rows.firstOrNull()
    val manager = context.getSystemService(NotificationManager::class.java)
    val liveUpdate = summary.liveUpdatesEnabled && canPostPromoted(manager)
    val accent = parseColor(summary.theme.accentColor, Color.GRAY)

    val builder = NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(headline(rows))
      .setContentText(firstRow?.let(::rowMetadata) ?: offlineLine(summary) ?: "")
      .setColor(accent)
      .setColorized(false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent(context, summary, firstRow))

    if (liveUpdate) {
      // Stock template. Multiple agents list in the expanded view; the chip
      // in the status bar carries the count or the approval nudge.
      val earliestStartMs = rows.mapNotNull { it.startedAtMs }.minOrNull()
      if (earliestStartMs != null) {
        builder.setShowWhen(true).setWhen(earliestStartMs.toLong()).setUsesChronometer(true)
      }
      if (rows.size > 1) {
        val inbox = NotificationCompat.InboxStyle()
        rows.take(MAX_LISTED_ROWS).forEach { row -> inbox.addLine(rowLine(row)) }
        builder.setStyle(inbox)
      }
      builder
        .setRequestPromotedOngoing(true)
        .setShortCriticalText(chipText(rows))
    } else {
      builder
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(collapsedView(context, summary, accent))
        .setCustomBigContentView(expandedView(context, summary, accent))
    }

    return builder.build()
  }

  /** Collapsed: the first agent as one row, or the idle headline. */
  private fun collapsedView(
    context: Context,
    summary: AgentStatusSummary,
    accent: Int,
  ): RemoteViews {
    val view = RemoteViews(context.packageName, R.layout.t3_agent_status_row)
    val row = summary.rows.firstOrNull()
    if (row == null) {
      view.setTextColor(R.id.status_row_dot, STARTING_COLOR)
      view.setTextViewText(R.id.status_row_title, headline(summary.rows))
      view.setTextViewText(R.id.status_row_metadata, offlineLine(summary) ?: "")
      view.setViewVisibility(R.id.status_row_chronometer, View.GONE)
      return view
    }
    bindRow(view, row, accent)
    val more = summary.rows.size - 1
    if (more > 0) {
      view.setViewVisibility(R.id.status_row_more, View.VISIBLE)
      view.setTextViewText(R.id.status_row_more, "+$more")
    }
    return view
  }

  private fun expandedView(
    context: Context,
    summary: AgentStatusSummary,
    accent: Int,
  ): RemoteViews = RemoteViews(context.packageName, R.layout.t3_agent_status_expanded).apply {
    removeAllViews(R.id.status_rows)
    summary.rows.take(MAX_LISTED_ROWS).forEach { row ->
      val rowView = RemoteViews(context.packageName, R.layout.t3_agent_status_row)
      bindRow(rowView, row, accent)
      addView(R.id.status_rows, rowView)
    }
    val footer = offlineLine(summary)
    if (footer == null && summary.rows.isNotEmpty()) {
      setViewVisibility(R.id.status_footer, View.GONE)
    } else {
      setViewVisibility(R.id.status_footer, View.VISIBLE)
      setTextViewText(R.id.status_footer, footer ?: headline(summary.rows))
    }
  }

  private fun bindRow(view: RemoteViews, row: AgentStatusRow, accent: Int) {
    view.setTextColor(R.id.status_row_dot, phaseColor(row.phase, accent))
    view.setTextViewText(R.id.status_row_title, row.threadTitle.ifBlank { "Untitled task" })
    view.setTextViewText(R.id.status_row_metadata, rowMetadata(row))
    view.setChronometerOrHide(R.id.status_row_chronometer, row.startedAtMs)
  }

  private fun RemoteViews.setChronometerOrHide(viewId: Int, startedAtMs: Double?) {
    if (startedAtMs == null) {
      setViewVisibility(viewId, View.GONE)
      return
    }
    val elapsedSinceStart = (System.currentTimeMillis() - startedAtMs.toLong()).coerceAtLeast(0L)
    setViewVisibility(viewId, View.VISIBLE)
    setChronometer(viewId, SystemClock.elapsedRealtime() - elapsedSinceStart, null, true)
  }

  private fun headline(rows: List<AgentStatusRow>): String {
    val approvals = rows.count { it.phase == "waiting_for_approval" }
    if (approvals == 1) return "1 agent needs approval"
    if (approvals > 1) return "$approvals agents need approval"
    return when (rows.size) {
      0 -> "No agents running"
      1 -> "1 agent working"
      else -> "${rows.size} agents working"
    }
  }

  /** Machine and project, plus the phase when the agent is blocked on the user. */
  private fun rowMetadata(row: AgentStatusRow): String {
    val place = listOf(row.environmentLabel, row.projectTitle)
      .filter { it.isNotBlank() }
      .joinToString(" · ")
    val blocked = row.phase == "waiting_for_approval" || row.phase == "waiting_for_input"
    return if (blocked && row.phaseLabel.isNotBlank()) "${row.phaseLabel} · $place" else place
  }

  private fun rowLine(row: AgentStatusRow): String =
    "${row.threadTitle.ifBlank { "Untitled task" }} · ${rowMetadata(row)}"

  /** Only worth a line when something is unreachable; all online is the default state. */
  private fun offlineLine(summary: AgentStatusSummary): String? {
    val online = summary.onlineCount.coerceAtLeast(0)
    val total = summary.totalCount.coerceAtLeast(0)
    if (total == 0 || online >= total) return null
    val offline = total - online
    return if (offline == 1) "1 machine offline" else "$offline machines offline"
  }

  private fun phaseColor(phase: String, accent: Int): Int =
    when (phase) {
      "waiting_for_approval" -> Color.parseColor(APPROVAL_COLOR)
      "waiting_for_input" -> Color.parseColor(INPUT_COLOR)
      "starting" -> STARTING_COLOR
      else -> accent
    }

  private fun chipText(rows: List<AgentStatusRow>): String {
    if (rows.any { it.phase == "waiting_for_approval" }) return "Approve"
    val text = if (rows.size == 1) "1 agent" else "${rows.size} agents"
    return if (text.length <= MAX_CHIP_LENGTH) text else "${rows.size}"
  }

  private fun parseColor(value: String, fallback: Int): Int =
    try {
      Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      fallback
    }

  private fun openAppIntent(
    context: Context,
    summary: AgentStatusSummary,
    firstRow: AgentStatusRow?,
  ): PendingIntent {
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
