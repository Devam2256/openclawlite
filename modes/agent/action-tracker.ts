import type { ActionLog, ActionStatus } from "./types.ts";
import { isMutationType } from "./types.ts";

export class ActionTracker {
   private actions: ActionLog[] = [];
   
   // collects logs and pushes it to the private actions array
    log(
        entry: Omit<ActionLog, 'id' | 'timestamp'> & {
            id?: string;
            timestamp?: Date;
        },
    ): ActionLog {
        const action: ActionLog = {
            id: entry.id ?? `action_${this.actions.length}`,
            timestamp: entry.timestamp ?? new Date(),
            type: entry.type,
            path: entry.path,
            details: { ...entry.details },
            status: entry.status,
            userApproved: entry.userApproved
        };
        this.actions.push(action);
        return action;
    };
    
    getActions(): readonly ActionLog[] {
        return this.actions;
    };
    
    pendingMutations(): ActionLog[] {
        return this.actions.filter(action => isMutationType(action.type) && action.status === 'pending');
    };

    updateStatus(id: string, status: ActionStatus, userApproved?: boolean): void {
        const a = this.actions.find(action => action.id === id);
        if (!a) return;
        a.status = status;
        if (userApproved !== undefined) {
            a.userApproved = userApproved;
        };
    };
};
