import type { Application } from 'express';

export interface TaskAssignment {
  id: string;
  agentName: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  assignedAt?: string;
  completedAt?: string;
  result?: string;
}

interface RelayClientLike {
  sendMessage: (
    to: string,
    body: string,
    kind?: string,
    data?: unknown,
    thread?: string
  ) => boolean;
}

export interface TasksRouteDeps {
  tasks: Map<string, TaskAssignment>;
  getRelayClient: (senderName?: string, entityType?: 'agent' | 'user') => Promise<RelayClientLike>;
  broadcastData: () => Promise<void>;
}

/**
 * Task assignment and lifecycle routes.
 */
export function registerTasksRoutes(app: Application, deps: TasksRouteDeps): void {
  const { tasks, getRelayClient, broadcastData } = deps;

  // GET /api/tasks - List all tasks.
  app.get('/api/tasks', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const agentName = typeof req.query.agent === 'string' ? req.query.agent : undefined;

    let allTasks = Array.from(tasks.values());

    if (status) {
      allTasks = allTasks.filter((t) => t.status === status);
    }
    if (agentName) {
      allTasks = allTasks.filter((t) => t.agentName === agentName);
    }

    allTasks.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return res.json({ success: true, tasks: allTasks });
  });

  // POST /api/tasks - Create and assign a task.
  app.post('/api/tasks', async (req, res) => {
    const { agentName, title, description, priority } = req.body;

    if (!agentName || !title || !priority) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: agentName, title, priority',
      });
    }

    const task: TaskAssignment = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentName,
      title,
      description: description || '',
      priority,
      status: 'assigned',
      createdAt: new Date().toISOString(),
      assignedAt: new Date().toISOString(),
    };

    tasks.set(task.id, task);

    try {
      const client = await getRelayClient('Dashboard');
      if (client) {
        const taskMessage = `TASK ASSIGNED [${priority.toUpperCase()}]: ${title}\n\n${description || 'No additional details.'}`;
        await client.sendMessage(agentName, taskMessage, 'message');
      }
    } catch (err) {
      console.warn('[api] Could not send task to agent:', err);
    }

    broadcastData().catch(() => {});
    return res.json({ success: true, task });
  });

  // PATCH /api/tasks/:id - Update task status.
  app.patch('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { status, result } = req.body;

    const task = tasks.get(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (status) {
      task.status = status;
      if (status === 'completed' || status === 'failed') {
        task.completedAt = new Date().toISOString();
      }
    }
    if (result !== undefined) {
      task.result = result;
    }

    tasks.set(id, task);
    broadcastData().catch(() => {});
    return res.json({ success: true, task });
  });

  // DELETE /api/tasks/:id - Cancel/delete a task.
  app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;

    const task = tasks.get(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.status === 'pending' || task.status === 'assigned' || task.status === 'in_progress') {
      try {
        const client = await getRelayClient('Dashboard');
        if (client) {
          await client.sendMessage(task.agentName, `TASK CANCELLED: ${task.title}`, 'message');
        }
      } catch (err) {
        console.warn('[api] Could not send task cancellation to agent:', err);
      }
    }

    tasks.delete(id);
    broadcastData().catch(() => {});
    return res.json({ success: true, message: 'Task cancelled' });
  });
}
