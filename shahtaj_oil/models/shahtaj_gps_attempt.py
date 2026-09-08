# -*- coding: utf-8 -*-
"""Log every shop GPS check (success and blocked) for bookers and delivery men."""
from odoo import api, fields, models


class ShahtajGpsAttempt(models.Model):
    _name = 'shahtaj.gps.attempt'
    _description = 'Shop GPS Attempt Log'
    _order = 'create_date desc, id desc'
    _rec_name = 'display_name'

    display_name = fields.Char(compute='_compute_display_name', store=True)

    user_id = fields.Many2one(
        'res.users',
        string='User',
        required=True,
        index=True,
        ondelete='cascade',
    )
    role = fields.Selection(
        [
            ('order_booker', 'Order Booker'),
            ('delivery_man', 'Delivery Man'),
            ('other', 'Other'),
        ],
        string='Role',
        required=True,
        default='other',
        index=True,
    )
    purpose = fields.Selection(
        [
            ('check_in', 'Check-in'),
            ('place_order', 'Place Order'),
            ('deliver', 'Deliver to Shop'),
        ],
        string='Purpose',
        required=True,
        index=True,
    )
    shop_id = fields.Many2one(
        'res.partner',
        string='Shop',
        index=True,
        ondelete='set null',
    )
    shop_latitude = fields.Float(string='Shop Latitude', digits=(10, 7))
    shop_longitude = fields.Float(string='Shop Longitude', digits=(10, 7))
    attempt_latitude = fields.Float(string='Attempt Latitude', digits=(10, 7))
    attempt_longitude = fields.Float(string='Attempt Longitude', digits=(10, 7))
    distance_m = fields.Float(string='Distance (m)', digits=(16, 2))
    min_distance_m = fields.Float(string='Min Allowed (m)', digits=(16, 2))
    max_distance_m = fields.Float(string='Max Allowed (m)', digits=(16, 2))
    result = fields.Selection(
        [
            ('ok', 'OK'),
            ('blocked_too_far', 'Blocked — Too Far'),
            ('blocked_too_close', 'Blocked — Too Close'),
            ('blocked_missing_shop_gps', 'Blocked — Shop GPS Missing'),
            ('blocked_missing_user_gps', 'Blocked — User GPS Missing'),
            ('blocked_invalid_coords', 'Blocked — Invalid Coordinates'),
        ],
        string='Result',
        required=True,
        index=True,
    )
    message = fields.Char(string='Detail')
    visit_task_id = fields.Many2one(
        'shahtaj.visit.task',
        string='Visit Task',
        ondelete='set null',
        index=True,
    )
    visit_id = fields.Many2one(
        'shahtaj.visit',
        string='Visit',
        ondelete='set null',
        index=True,
    )
    dm_delivery_id = fields.Many2one(
        'shahtaj.dm.delivery',
        string='Delivery Job',
        ondelete='set null',
        index=True,
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company,
        index=True,
    )

    @api.depends('shop_id', 'user_id', 'result', 'purpose', 'distance_m')
    def _compute_display_name(self):
        purpose_labels = dict(self._fields['purpose'].selection)
        result_labels = dict(self._fields['result'].selection)
        for rec in self:
            shop = rec.shop_id.display_name if rec.shop_id else '—'
            user = rec.user_id.display_name if rec.user_id else '—'
            purpose = purpose_labels.get(rec.purpose, rec.purpose or '')
            result = result_labels.get(rec.result, rec.result or '')
            dist = ''
            if rec.distance_m:
                dist = f' · {rec.distance_m:.0f} m'
            rec.display_name = f'{purpose}: {user} @ {shop} — {result}{dist}'

    @api.model
    def _shahtaj_resolve_role(self, user=None):
        user = user or self.env.user
        if getattr(user, 'shahtaj_is_delivery_man', False):
            return 'delivery_man'
        if getattr(user, 'shahtaj_is_order_booker', False):
            return 'order_booker'
        return 'other'

    @api.model
    def log_attempt(
        self,
        *,
        purpose,
        result,
        shop=None,
        latitude=None,
        longitude=None,
        distance_m=0.0,
        min_distance_m=0.0,
        max_distance_m=0.0,
        message='',
        user=None,
        visit_task=None,
        visit=None,
        dm_delivery=None,
        role=None,
    ):
        """Create a GPS attempt row (sudo). Never raises to callers."""
        try:
            user = user or self.env.user
            shop = shop.sudo() if shop else shop
            vals = {
                'user_id': user.id,
                'role': role or self._shahtaj_resolve_role(user),
                'purpose': purpose,
                'result': result,
                'distance_m': float(distance_m or 0.0),
                'min_distance_m': float(min_distance_m or 0.0),
                'max_distance_m': float(max_distance_m or 0.0),
                'message': (message or '')[:512],
                'company_id': self.env.company.id,
            }
            if shop:
                vals['shop_id'] = shop.id
                vals['shop_latitude'] = shop.partner_latitude or 0.0
                vals['shop_longitude'] = shop.partner_longitude or 0.0
            if latitude is not None:
                vals['attempt_latitude'] = float(latitude)
            if longitude is not None:
                vals['attempt_longitude'] = float(longitude)
            if visit_task:
                vals['visit_task_id'] = visit_task.id
            if visit:
                vals['visit_id'] = visit.id
            if dm_delivery:
                vals['dm_delivery_id'] = dm_delivery.id
            return self.sudo().create(vals)
        except Exception:  # noqa: BLE001 — logging must never block check-in/deliver
            return self.browse()
