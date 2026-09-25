/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { notifyPortalBusy } from "../shahtaj_access";

const DONE_STATES = ["delivered", "returned"];

export class DeliveryManPerformance extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        const today = new Date();
        this.todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const ITEMS_PER_PAGE = 50;
        this.state = useState({
            date: this.todayStr,
            isLoading: false,
            rows: [],
            selectedDm: null,
            jobs: [],
            pagination: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
            deliveryMen: [],
            filters: { search: "", dm: "all" },
            searchTimeout: null,
        });

        this.debouncedFetch = () => {
            clearTimeout(this.state.searchTimeout);
            this.state.searchTimeout = setTimeout(() => this.fetchProgress(), 400);
        };

        onWillStart(async () => {
            await Promise.all([this.fetchDeliveryMen(), this.fetchProgress()]);
        });
    }

    dateDomain(field = "scheduled_date") {
        return [[field, "=", this.state.date || this.todayStr]];
    }

    _userDomain() {
        const domain = [["shahtaj_is_delivery_man", "=", true], ["active", "=", true]];
        const search = (this.state.filters.search || "").trim();
        if (search) {
            domain.push("|", ["name", "ilike", search], ["shahtaj_employee_code", "ilike", search]);
        }
        if (this.state.filters.dm && this.state.filters.dm !== "all") {
            domain.push(["id", "=", parseInt(this.state.filters.dm, 10)]);
        }
        return domain;
    }

    async fetchDeliveryMen() {
        try {
            this.state.deliveryMen = await this.orm.searchRead(
                "res.users",
                [["shahtaj_is_delivery_man", "=", true], ["active", "=", true]],
                ["id", "name"],
                { order: "name asc" },
            );
        } catch (error) {
            this.state.deliveryMen = [];
        }
    }

    _countByDm(groups) {
        const map = {};
        for (const group of groups || []) {
            const id = Array.isArray(group.delivery_man_id) ? group.delivery_man_id[0] : group.delivery_man_id;
            if (!id) continue;
            map[id] = (map[id] || 0) + (group.__count || group.delivery_man_id_count || 0);
        }
        return map;
    }

    async _jobStats(userIds) {
        const stats = {};
        if (!userIds.length) return stats;
        const domain = [
            ["delivery_man_id", "in", userIds],
            ...this.dateDomain("scheduled_date"),
        ];
        const groupBy = ["delivery_man_id"];
        const [assignedGroups, doneGroups] = await Promise.all([
            this.orm.call("shahtaj.dm.delivery", "read_group", [domain, ["delivery_man_id"], groupBy]),
            this.orm.call("shahtaj.dm.delivery", "read_group", [
                domain.concat([["state", "in", DONE_STATES]]),
                ["delivery_man_id"],
                groupBy,
            ]),
        ]);
        const assigned = this._countByDm(assignedGroups);
        const done = this._countByDm(doneGroups);
        for (const id of userIds) {
            stats[id] = {
                assigned: assigned[id] || 0,
                done: done[id] || 0,
            };
        }
        return stats;
    }

    async fetchProgress() {
        this.state.isLoading = true;
        notifyPortalBusy(true);
        const pag = this.state.pagination;
        try {
            const domain = this._userDomain();
            const fields = [
                "id", "name", "shahtaj_employee_code", "shahtaj_online_status",
            ];
            const [total, users] = await Promise.all([
                this.orm.searchCount("res.users", domain),
                this.orm.searchRead("res.users", domain, fields, {
                    limit: pag.limit,
                    offset: (pag.page - 1) * pag.limit,
                    order: "name asc",
                }),
            ]);
            this.state.pagination.total = total;
            const stats = await this._jobStats(users.map((user) => user.id));
            this.state.rows = users.map((user) => {
                const bucket = stats[user.id] || { assigned: 0, done: 0 };
                const pending = Math.max(bucket.assigned - bucket.done, 0);
                const progress = bucket.assigned ? (bucket.done / bucket.assigned) * 100 : 0;
                return {
                    id: user.id,
                    name: user.name,
                    code: user.shahtaj_employee_code || "",
                    status: user.shahtaj_online_status || "offline",
                    assigned: bucket.assigned,
                    done: bucket.done,
                    pending,
                    progress,
                };
            });
        } catch (error) {
            this.notification.add("Failed to load delivery progress: " + (error.data?.message || error.message), { type: "danger" });
            this.state.rows = [];
        } finally {
            this.state.isLoading = false;
            notifyPortalBusy(false);
        }
    }

    async openDm(row) {
        this.state.selectedDm = row;
        await this.fetchDmJobs();
    }

    closeDm() {
        this.state.selectedDm = null;
        this.state.jobs = [];
    }

    async fetchDmJobs() {
        if (!this.state.selectedDm) return;
        this.state.isLoading = true;
        try {
            const jobs = await this.orm.searchRead(
                "shahtaj.dm.delivery",
                [
                    ["delivery_man_id", "=", this.state.selectedDm.id],
                    ...this.dateDomain("scheduled_date"),
                ],
                ["id", "sale_order_id", "partner_id", "scheduled_date", "state", "field_state", "is_walk_in"],
                { order: "scheduled_date desc, id desc", limit: 200 },
            );
            this.state.jobs = jobs.map((job) => ({
                id: job.id,
                order: job.sale_order_id ? job.sale_order_id[1] : "—",
                shop: job.partner_id ? job.partner_id[1] : "—",
                date: job.scheduled_date || "—",
                state: job.state || "",
                fieldState: job.field_state || "",
                isWalkIn: !!job.is_walk_in,
            }));
        } catch (error) {
            this.notification.add("Failed to load deliveries: " + (error.data?.message || error.message), { type: "danger" });
            this.state.jobs = [];
        } finally {
            this.state.isLoading = false;
        }
    }

    onSearchInput(ev) {
        this.state.filters.search = ev.target.value;
        this.state.pagination.page = 1;
        this.debouncedFetch();
    }

    isDmSelected(id) {
        return String(id) === String(this.state.filters.dm);
    }

    onDmFilterChange(ev) {
        this.state.filters.dm = ev.target.value || "all";
        this.onFilterChange();
    }

    onFilterChange() {
        this.state.pagination.page = 1;
        this.fetchProgress();
    }

    refreshActive() {
        if (!this.state.date) this.state.date = this.todayStr;
        this.state.pagination.page = 1;
        if (this.state.selectedDm) return this.fetchDmJobs();
        return this.fetchProgress();
    }

    changePage(direction) {
        const pag = this.state.pagination;
        const newPage = pag.page + direction;
        const maxPage = Math.max(1, Math.ceil(pag.total / pag.limit));
        if (newPage < 1 || newPage > maxPage) return;
        pag.page = newPage;
        this.fetchProgress();
    }

    statusLabel(status) {
        const map = { online: "Online", away: "Away", offline: "Offline" };
        return map[status] || status || "—";
    }

    statusClass(status) {
        if (status === "online") return "bg-success text-white";
        if (status === "away") return "bg-warning text-dark";
        return "bg-secondary text-white";
    }

    stockLabel(state) {
        return ({
            not_ready: "Waiting Invoice",
            ready: "Ready to Pick",
            picked: "Loaded on Van",
            partial: "Part Delivered",
            delivered: "Delivered",
            returned: "Returned to WH",
        })[state] || state || "—";
    }

    stockClass(state) {
        if (state === "delivered") return "bg-success text-white";
        if (state === "returned") return "bg-danger text-white";
        if (state === "picked" || state === "partial") return "bg-warning text-dark";
        if (state === "ready") return "bg-info text-white";
        return "bg-light text-dark";
    }

    stopLabel(state) {
        return ({
            pending: "Not Started",
            in_transit: "Heading to Shop",
            not_attended: "Shop Closed",
            failed: "Could Not Deliver",
            done: "Stop Done",
        })[state] || state || "—";
    }

    stopClass(state) {
        if (state === "done") return "bg-success text-white";
        if (state === "in_transit") return "bg-info text-white";
        if (state === "not_attended" || state === "failed") return "bg-warning text-dark";
        return "bg-light text-dark";
    }
}

DeliveryManPerformance.template = "shahtaj_oil.DeliveryManPerformance";
