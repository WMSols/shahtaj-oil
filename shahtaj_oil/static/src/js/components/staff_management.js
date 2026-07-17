/** @odoo-module **/

import { Component, useState, onWillStart,onMounted, onWillUnmount } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class StaffManagement extends Component {
    setup() {
        this.orm = useService("orm");
        this.state = useState({
            activeTab: 'order_booker',
            viewMode: 'list', 
            detailTab: 'schedules', 
            selectedStaff: null,
            showForm: false,
            isLoading: false,
            showPassword: false,
            editingStaffId: null,
            
            staffList: [],
            detailSchedules: [],
            detailTargets: [],
            
            // New state properties for Search and Filter
            searchQuery: '',
            filterStatus: 'all', // 'all', 'online', 'active', 'suspended'
            
            formData: { 
                name: '', 
                employee_code: '', 
                email: '',
                password: '',
                role: 'order_booker'
            }
        });

       // 2. Variable to hold our interval ID
        this.pollingInterval = null;

        onWillStart(async () => {
            await this.fetchStaffData();
        });

        // 3. Start polling when the component loads
        onMounted(() => {
            // Fetch fresh data every 15 seconds (15000 ms)
            this.pollingInterval = setInterval(() => {
                this.fetchStaffData();
            }, 15000);
        });

        // 4. Clean up the interval if the user navigates away
        onWillUnmount(() => {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
        });
    }

    // New Getter to handle dynamic searching and filtering
    get filteredStaffList() {
        return this.state.staffList.filter(staff => {
            // 1. Search Logic
            const searchLower = this.state.searchQuery.toLowerCase();
            const nameMatch = staff.name.toLowerCase().includes(searchLower);
            const codeMatch = staff.employee_code && staff.employee_code.toLowerCase().includes(searchLower);
            const matchesSearch = nameMatch || codeMatch;

            // 2. Filter Logic
            let matchesFilter = true;
            if (this.state.filterStatus === 'online') {
                matchesFilter = staff.status === 'online';
            } else if (this.state.filterStatus === 'active') {
                matchesFilter = staff.active === true;
            } else if (this.state.filterStatus === 'suspended') {
                matchesFilter = staff.active === false;
            }

            return matchesSearch && matchesFilter;
        });
    }

    async fetchStaffData() {
        const bookers = await this.orm.searchRead(
            "res.users",
            [["shahtaj_is_order_booker", "=", true], ["active", "in", [true, false]]],
            [
                "id", "name", "shahtaj_employee_code", "shahtaj_online_status",
                "shahtaj_last_seen_at",
                "shahtaj_task_today_total", "shahtaj_task_today_pending", "shahtaj_task_today_done",
                "shahtaj_active_target_progress", "shahtaj_active_target_summary", "active"
            ]
        );
        
        this.state.staffList = bookers.map(u => ({
            id: u.id,
            name: u.name,
            login: u.login,
            employee_code: u.shahtaj_employee_code,
            role: "Order Booker",
            status: u.shahtaj_online_status,
            active: u.active,
            last_seen_at: u.shahtaj_last_seen_at || false,
            last_seen_label: this.formatLastSeen(u.shahtaj_last_seen_at),
            metrics: {
                today: { 
                    total: u.shahtaj_task_today_total, 
                    pending: u.shahtaj_task_today_pending, 
                    completed: u.shahtaj_task_today_done 
                },
                activeTarget: { 
                    summary: u.shahtaj_active_target_summary, 
                    progress: u.shahtaj_active_target_progress 
                }
            }
        }));
    }

    formatLastSeen(value) {
        if (!value) {
            return "Never seen";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    async openDetails(staff) {
        this.state.selectedStaff = staff;
        
        const schedules = await this.orm.searchRead(
            "shahtaj.weekly.schedule",
            [["order_booker_id", "=", staff.id]],
            ["id", "day_of_week", "route_id", "zone_id", "active"] 
        );

        const dayMap = {
            '0': 'Monday', '1': 'Tuesday', '2': 'Wednesday', 
            '3': 'Thursday', '4': 'Friday', '5': 'Saturday', '6': 'Sunday'
        };

        this.state.detailSchedules = schedules.map(s => ({
            ...s,
            day: dayMap[s.day_of_week] || s.day_of_week
        }));

        this.state.detailTargets = await this.orm.searchRead(
            "shahtaj.visit.target",
            [["order_booker_id", "=", staff.id]],
            ["id", "date_start", "date_end", "target_type", "target_value", "achieved_value", "progress_percent", "active"]
        );

        this.state.viewMode = 'detail';
        this.state.detailTab = 'schedules';
    }

    switchTab(tabName) {
        this.state.activeTab = tabName;
        this.state.viewMode = 'list';
        this.fetchStaffData();
    }

    goBack() {
        this.state.selectedStaff = null;
        this.state.viewMode = 'list';
        this.fetchStaffData();
    }

    openForm() {
        this.state.formData = { name: '', employee_code: '', email: '', password: '', role: 'order_booker' };
        this.state.editingStaffId = null;
        this.state.showForm = true;
    }

    cancelForm() {
        this.state.showForm = false;
        this.state.showPassword = false;
        this.state.editingStaffId = null;
        this.state.formData = { name: '', employee_code: '', email: '', password: '', role: 'order_booker' };
    }

    editStaff(staff) {
        this.state.formData = {
            name: staff.name,
            employee_code: staff.employee_code || '',
            email: staff.login || '',
            password: '', 
            role: 'order_booker'
        };
        this.state.editingStaffId = staff.id;
        this.state.showForm = true;
    }

    async saveStaff() {
        if (!this.state.formData.name || !this.state.formData.email) {
            alert("Name and App Login Email are required.");
            return;
        }

        try {
            if (this.state.editingStaffId) {
                const payload = {
                    name: this.state.formData.name,
                    login: this.state.formData.email,
                    shahtaj_employee_code: this.state.formData.employee_code,
                };
                
                if (this.state.formData.password) {
                    payload.password = this.state.formData.password;
                }

                await this.orm.write("res.users", [this.state.editingStaffId], payload);

            } else {
                if (!this.state.formData.password) {
                    alert("Password is required for new accounts.");
                    return;
                }

                const wizardIds = await this.orm.create("shahtaj.create.order.booker.wizard", [{
                    name: this.state.formData.name,
                    login: this.state.formData.email,
                    password: this.state.formData.password,
                    shahtaj_employee_code: this.state.formData.employee_code,
                }]);

                await this.orm.call("shahtaj.create.order.booker.wizard", "action_create_booker", [wizardIds]);
            }

            this.cancelForm();
            await this.fetchStaffData();

        } catch (error) {
            console.error("Save failed:", error);
            const errorMessage = error.data?.message || error.message || "Unknown error occurred";
            alert(`Failed to save order booker:\n\n${errorMessage}`);
        }
    }

    async toggleActiveStatus(staffId, currentStatus) {
        const newStatus = !currentStatus;
        const actionWord = newStatus ? "activate" : "deactivate";
        
        if (!confirm(`Are you sure you want to ${actionWord} this order booker?`)) return;

        try {
            const methodName = newStatus ? "action_shahtaj_activate_booker" : "action_shahtaj_deactivate_booker";
            await this.orm.call("res.users", methodName, [[staffId]]);
            
            await this.fetchStaffData();
            if (this.state.selectedStaff && this.state.selectedStaff.id === staffId) {
                this.state.selectedStaff.active = newStatus;
            }
        } catch (error) {
            console.error("Failed to toggle status:", error);
            alert("An error occurred while updating the status.");
        }
    }
}

StaffManagement.template = "shahtaj_oil.StaffManagement";