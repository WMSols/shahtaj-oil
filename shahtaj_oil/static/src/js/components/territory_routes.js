/** @odoo-module **/

import { Component, useState, onWillStart, useEffect, useRef,onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ConfirmModal } from "./confirm_modal"; 

export class TerritoryRoutes extends Component {
    static props = {
        requestedSubTab: { type: String, optional: true },
    };
    static components = { ConfirmModal };
    setup() {
        this.orm = useService("orm");

        this.mapRef = useRef("mapContainer");
        this.mapInstance = null; 

        this.state = useState({
           activeSubTab: this.props.requestedSubTab || 'areas', 
           previousSubTab: 'areas',
            
            showAreaForm: false,
            showRouteForm: false,
            showShopForm: false,
            selectedShopDetails: null,
            shopCategoryEdit: 'credit',

            editingAreaId: null,
            editingRouteId: null,
            editingShopId: null,

            // --- Search & Filter States ---
            areaSearchQuery: '',
            areaFilterStatus: 'all',

            routeSearchQuery: '',
            routeFilterStatus: 'all',

            shopSearchQuery: '',
            shopFilterCategory: 'all',
            shopFilterStatus: 'all',

            // Custom Modal State
            confirmModal: { isOpen: false, title: '', message: '', onConfirm: null },
            isLoading: false,

            areaForm: { name: '', is_active: true },
            routeForm: { name: '', zone_id: '', is_active: true }, 
            shopForm: { 
                name: '', owner_name: '', owner_phone: '', owner_cnic_number: '', address: '',
                zone_id: '', route_id: '', lat: '', lng: '', 
                shopCategory: 'credit',
                creditLimit: '', legacyBalance: '', outstandingBalance: '',
                owner_cnic_front: null, owner_cnic_back: null, 
                owner_photo: null, shop_exterior_photo: null,
                preview_owner_cnic_front: null, preview_owner_cnic_back: null, 
                preview_owner_photo: null, preview_shop_exterior_photo: null
            },

            areas: [],
            routes: [],
            shops: []
        });
        // ADD THIS NEW BLOCK RIGHT AFTER THE STATE CLOSING BRACKET:
        onWillUpdateProps((nextProps) => {
            if (nextProps.requestedSubTab && nextProps.requestedSubTab !== this.state.activeSubTab) {
                this.setSubTab(nextProps.requestedSubTab);
            }
        });

        useEffect(() => {
            if (this.mapInstance) {
                this.mapInstance.remove();
                this.mapInstance = null;
            }

            const mapEl = this.mapRef.el;
            const shop = this.state.selectedShopDetails;

            if (mapEl && shop && shop.partner_latitude && shop.partner_longitude) {
                if (typeof L !== 'undefined') {
                    this.mapInstance = L.map(mapEl).setView([shop.partner_latitude, shop.partner_longitude], 16);
                    
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19,
                        attribution: '© OpenStreetMap'
                    }).addTo(this.mapInstance);

                    L.marker([shop.partner_latitude, shop.partner_longitude])
                        .addTo(this.mapInstance)
                        .bindPopup(`<b>${shop.name}</b><br/>${shop.owner_name}`)
                        .openPopup();
                } else {
                    console.warn("Leaflet library is missing! Check your __manifest__.py assets.");
                }
            }
            
            return () => {
                if (this.mapInstance) {
                    this.mapInstance.remove();
                    this.mapInstance = null;
                }
            };
        }, () => [this.mapRef.el, this.state.selectedShopDetails]);

        onWillStart(async () => {
            await this.fetchDashboardData();
        });
    }
    // NEW Refresh Method
    async refreshData() {
        this.state.isLoading = true;
        try {
            await this.fetchDashboardData();
        } finally {
            this.state.isLoading = false;
        }
    }
    // Custom Modal Controller
    showConfirm(title, message, onConfirmCallback) {
     this.state.confirmModal = {
         isOpen: true,
         title: title,
         message: message,
         onConfirm: async () => {
             this.state.confirmModal.isOpen = false;
             await onConfirmCallback();
         }
     };
 }

 closeConfirm() {
     this.state.confirmModal.isOpen = false;
 }

    // --- Dynamic Search & Filter Getters ---
  get displayAreas() {
        return this.state.areas.filter(area => area.active && area.name.toLowerCase().includes(this.state.areaSearchQuery.toLowerCase()));
    }

    get displayRoutes() {
        return this.state.routes.filter(route => route.active && route.name.toLowerCase().includes(this.state.routeSearchQuery.toLowerCase()));
    }

    get displayShops() {
        return this.state.shops.filter(shop => {
            if (!shop.active) return false;
            
            const query = this.state.shopSearchQuery.toLowerCase();
            const searchMatch = shop.name.toLowerCase().includes(query) || (shop.owner_name || '').toLowerCase().includes(query);
            const categoryMatch = this.state.shopFilterCategory !== 'all' ? shop.shahtaj_shop_category === this.state.shopFilterCategory : true;
            const statusMatch = this.state.shopFilterStatus !== 'all' ? shop.shop_approval_state === this.state.shopFilterStatus : true;

            return searchMatch && categoryMatch && statusMatch;
        });
    }

    // --- Data Fetching Logic ---
    async fetchDashboardData() {
        const includeArchivedDomain = ['|', ['active', '=', true], ['active', '=', false]];

        this.state.areas = await this.orm.searchRead(
            "shahtaj.zone",
            includeArchivedDomain, 
            ["id", "name", "active", "route_count"]
        );

        this.state.routes = await this.orm.searchRead(
            "shahtaj.route",
            includeArchivedDomain,
            ["id", "name", "zone_id", "shop_count", "active"]
        );

        this.state.shops = await this.orm.searchRead(
            "res.partner",
            [["is_shahtaj_shop", "=", true], ...includeArchivedDomain], 
            ["id", "name", "owner_name", "phone", "route_id", "shop_approval_state", "shahtaj_shop_category", "registered_by_id", "active"]
        );
    }

    setSubTab(tabName) {
        // Save the current tab if we are navigating to the archive
        if (tabName === 'archive' && this.state.activeSubTab !== 'archive') {
            this.state.previousSubTab = this.state.activeSubTab;
        }
        
        this.state.activeSubTab = tabName;
        this.cancelForms();
        this.state.selectedShopDetails = null;
    }
    cancelForms() {
        this.state.showAreaForm = false;
        this.state.showRouteForm = false;
        this.state.showShopForm = false;
        
        this.state.editingAreaId = null;
        this.state.editingRouteId = null;
        this.state.editingShopId = null;

        this.resetForms();
    }

    resetForms() {
        this.state.areaForm = { name: '', is_active: true };
        this.state.routeForm = { name: '', zone_id: '', is_active: true };
        this.state.shopForm = { 
            name: '', owner_name: '', owner_phone: '', owner_cnic_number: '', address: '',
            zone_id: '', route_id: '', lat: '', lng: '', 
            shopCategory: 'credit',
            creditLimit: '', legacyBalance: '', outstandingBalance: '',
            owner_cnic_front: null, owner_cnic_back: null, 
            owner_photo: null, shop_exterior_photo: null,
            preview_owner_cnic_front: null, preview_owner_cnic_back: null, 
            preview_owner_photo: null, preview_shop_exterior_photo: null
        };
    }
    // --- Archive Logic & Getters ---
    toggleArchive(model, id, makeActive) {
     if (makeActive) {
         // Restoring typically doesn't need a heavy confirmation prompt
         this.executeToggleArchive(model, id, makeActive);
     } else {
         // Archiving gets the new custom modal
         this.showConfirm(
             "Archive Item",
             "Are you sure you want to move this item to the archive?",
             () => this.executeToggleArchive(model, id, makeActive)
         );
     }
 }

 async executeToggleArchive(model, id, makeActive) {
     try {
         await this.orm.write(model, [id], { active: makeActive });
         await this.fetchDashboardData();
     } catch (error) {
         alert("Failed to update archive status: " + (error.data?.message || error.message));
     }
 }

    get archivedZones() { return this.state.areas.filter(a => !a.active); }
    get archivedRoutes() { return this.state.routes.filter(r => !r.active); }
    get archivedShops() { return this.state.shops.filter(s => !s.active); }

    onZoneChange() {
        this.state.shopForm.route_id = '';
    }

    get filteredRoutes() {
        if (!this.state.shopForm.zone_id) return [];
        const selectedZoneId = parseInt(this.state.shopForm.zone_id);
        return this.state.routes.filter(r => r.zone_id && r.zone_id[0] === selectedZoneId);
    }

    onFileChange(ev, fieldName) {
        const file = ev.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            const base64Data = dataUrl.split(',')[1];
            
            this.state.shopForm[fieldName] = base64Data;
            this.state.shopForm[`preview_${fieldName}`] = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    async viewShopDetails(shopId) {
        const details = await this.orm.read(
            "res.partner",
            [shopId],
            [
                "id", "name", "owner_name", "phone", "owner_cnic_number", "partner_latitude", "partner_longitude",
                "shahtaj_shop_category", "credit_limit", "legacy_balance", "outstanding_balance",
                "route_id", "zone_id", "registered_by_id",
                "owner_cnic_front", "owner_cnic_back", "owner_photo", "shop_exterior_photo", 
                "shop_approval_state"
            ]
        );
        if (details.length > 0) {
            this.state.selectedShopDetails = details[0];
            this.state.shopCategoryEdit = details[0].shahtaj_shop_category || 'credit';
        }
    }

    closeShopDetails() {
        this.state.selectedShopDetails = null;
        this.state.shopCategoryEdit = 'credit';
    }

    async saveShopCategory() {
        if (!this.state.selectedShopDetails) return;
        const shopId = this.state.selectedShopDetails.id;
        try {
            await this.orm.write("res.partner", [shopId], {
                shahtaj_shop_category: this.state.shopCategoryEdit,
            });
            await this.viewShopDetails(shopId);
            await this.fetchDashboardData();
        } catch (error) {
            alert("Failed to update shop category: " + (error.data?.message || error.message));
        }
    }

    async approveShop(shopId) {
        try {
            await this.orm.call("res.partner", "action_approve_shop", [[shopId]]);
            await this.fetchDashboardData();
        } catch (error) {
            alert("Failed to approve shop: " + (error.data?.message || error.message));
        }
    }

    async rejectShop(shopId) {
        try {
            await this.orm.call("res.partner", "action_reject_shop", [[shopId]]);
            await this.fetchDashboardData();
        } catch (error) {
            alert("Failed to reject shop: " + (error.data?.message || error.message));
        }
    }

    editArea(area) {
        this.state.areaForm = { name: area.name, is_active: area.active };
        this.state.editingAreaId = area.id;
        this.state.showAreaForm = true;
    }

    editRoute(route) {
        this.state.routeForm = { 
            name: route.name, 
            zone_id: route.zone_id ? route.zone_id[0] : '', 
            is_active: route.active 
        };
        this.state.editingRouteId = route.id;
        this.state.showRouteForm = true;
    }

    async editShop(shop) {
        const details = await this.orm.read("res.partner", [shop.id], [
            "name", "owner_name", "phone", "owner_cnic_number", "zone_id", "route_id",
            "partner_latitude", "partner_longitude", "shahtaj_shop_category", "credit_limit", "legacy_balance"
        ]);

        if (details.length > 0) {
            const d = details[0];
            this.state.shopForm = {
                name: d.name || '',
                owner_name: d.owner_name || '',
                owner_phone: d.phone || '',
                owner_cnic_number: d.owner_cnic_number || '',
                zone_id: d.zone_id ? d.zone_id[0] : '',
                route_id: d.route_id ? d.route_id[0] : '',
                lat: d.partner_latitude || '',
                lng: d.partner_longitude || '',
                shopCategory: d.shahtaj_shop_category || 'credit',
                creditLimit: d.credit_limit || '',
                legacyBalance: d.legacy_balance || '',
                owner_cnic_front: null, owner_cnic_back: null, 
                owner_photo: null, shop_exterior_photo: null,
                preview_owner_cnic_front: null, preview_owner_cnic_back: null, 
                preview_owner_photo: null, preview_shop_exterior_photo: null
            };
            this.state.editingShopId = shop.id;
            this.state.showShopForm = true;
        }
    }

    async saveArea() {
        if (!this.state.areaForm.name) return;

        const payload = {
            name: this.state.areaForm.name,
            active: this.state.areaForm.is_active
        };

        if (this.state.editingAreaId) {
            await this.orm.write("shahtaj.zone", [this.state.editingAreaId], payload);
        } else {
            await this.orm.create("shahtaj.zone", [payload]);
        }

        this.cancelForms();
        await this.fetchDashboardData(); 
    }

    async saveRoute() {
        if (!this.state.routeForm.name || !this.state.routeForm.zone_id) {
            alert("Route Name and Parent Zone are required.");
            return;
        }

        const payload = {
            name: this.state.routeForm.name,
            zone_id: parseInt(this.state.routeForm.zone_id),
            active: this.state.routeForm.is_active
        };

        if (this.state.editingRouteId) {
            await this.orm.write("shahtaj.route", [this.state.editingRouteId], payload);
        } else {
            await this.orm.create("shahtaj.route", [payload]);
        }

        this.cancelForms();
        await this.fetchDashboardData();
    }

    async saveShop() {
        const lat = parseFloat(this.state.shopForm.lat);
        const lng = parseFloat(this.state.shopForm.lng);

        if (!this.state.shopForm.name || !this.state.shopForm.owner_name || isNaN(lat) || isNaN(lng)) {
            alert("Please fill all required fields including valid GPS coordinates.");
            return;
        }

        const payload = {
            is_shahtaj_shop: true,
            company_type: 'company',
            shahtaj_shop_category: this.state.shopForm.shopCategory || 'credit',
            name: this.state.shopForm.name,
            owner_name: this.state.shopForm.owner_name,
            owner_phone: this.state.shopForm.owner_phone,
            phone: this.state.shopForm.owner_phone,
            owner_cnic_number: this.state.shopForm.owner_cnic_number || false,
            zone_id: this.state.shopForm.zone_id ? parseInt(this.state.shopForm.zone_id) : false,
            route_id: this.state.shopForm.route_id ? parseInt(this.state.shopForm.route_id) : false,
            partner_latitude: lat,
            partner_longitude: lng,
            credit_limit: this.state.shopForm.shopCategory === 'credit'
                ? (parseFloat(this.state.shopForm.creditLimit) || 0.0)
                : 0.0,
            legacy_balance: parseFloat(this.state.shopForm.legacyBalance) || 0.0,
        };

        if (this.state.shopForm.owner_cnic_front) payload.owner_cnic_front = this.state.shopForm.owner_cnic_front;
        if (this.state.shopForm.owner_cnic_back) payload.owner_cnic_back = this.state.shopForm.owner_cnic_back;
        if (this.state.shopForm.owner_photo) payload.owner_photo = this.state.shopForm.owner_photo;
        if (this.state.shopForm.shop_exterior_photo) payload.shop_exterior_photo = this.state.shopForm.shop_exterior_photo;

        if (this.state.editingShopId) {
            await this.orm.write("res.partner", [this.state.editingShopId], payload);
        } else {
            payload.shop_approval_state = 'pending';
            await this.orm.create("res.partner", [payload]);
        }

        this.cancelForms();
        await this.fetchDashboardData();
    }
}

TerritoryRoutes.template = "shahtaj_oil.TerritoryRoutes";